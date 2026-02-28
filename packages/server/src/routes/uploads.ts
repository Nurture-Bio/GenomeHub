import { Router } from 'express';
import { AppDataSource } from '../app_data.js';
import { User, GenomicFile } from '../entities/index.js';
import {
  buildS3Key, initiateMultipartUpload, presignPartUrl,
  completeMultipartUpload, abortMultipartUpload, headObject,
  BUCKET,
} from '../lib/s3.js';
import * as edges from '../lib/edge_service.js';
import { detectFormat } from '@genome-hub/shared';
import { asyncWrap } from '../lib/async_wrap.js';
import { convertJsonToParquet } from '../lib/parquet.js';

const router = Router();

/** Step 1 — register file metadata and initiate S3 multipart */
router.post('/initiate', asyncWrap(async (req, res) => {
  const { filename, contentType, sizeBytes, description, tags, organismIds, collectionId, types, type } =
    req.body as {
      filename:    string;
      contentType: string;
      sizeBytes:   number;
      description?: string;
      tags?: string[];
      organismIds?: string[];
      collectionId?: string;
      types?: string[];
      type?: string;  // backward compat: single string
    };

  if (!filename) {
    res.status(400).json({ error: 'filename required' });
    return;
  }

  const repo = AppDataSource.getRepository(GenomicFile);
  const file = repo.create({
    filename,
    sizeBytes,
    description: description ?? null,
    tags:   tags ?? [],
    status: 'pending',
    s3Key:  '',   // filled after we have the id
    format: detectFormat(filename),
    type:   types ?? (type ? [type] : ['raw']),
    uploadedBy: (res.locals.user as User)?.email ?? null,
  });
  await repo.save(file);

  const s3Key   = buildS3Key(file.id, filename);
  const uploadId = await initiateMultipartUpload(s3Key, contentType);

  file.s3Key    = s3Key;
  file.uploadId = uploadId;
  await repo.save(file);

  // Create edges for relationships
  const userId = (res.locals.user as User)?.id ?? null;
  if (collectionId) {
    await edges.link({ type: 'file', id: file.id }, { type: 'collection', id: collectionId }, 'belongs_to', null, userId);
  }
  if (organismIds?.length) {
    for (const orgId of organismIds) {
      await edges.link({ type: 'file', id: file.id }, { type: 'organism', id: orgId }, 'from_organism', null, userId);
    }
  }

  res.json({ fileId: file.id, uploadId, s3Key });
}));

/** Step 2 — presigned URL for one part */
router.post('/part-url', asyncWrap(async (req, res) => {
  const { s3Key, uploadId, partNumber } =
    req.body as { fileId: string; s3Key: string; uploadId: string; partNumber: number };

  const url = await presignPartUrl(s3Key, uploadId, partNumber);
  res.json({ url });
}));

/** Step 3 — finalize multipart and mark file ready */
router.post('/complete', asyncWrap(async (req, res) => {
  const { fileId, uploadId, s3Key, parts } =
    req.body as {
      fileId:   string;
      uploadId: string;
      s3Key:    string;
      parts:    { PartNumber: number; ETag: string }[];
    };

  await completeMultipartUpload(s3Key, uploadId, parts);

  // Verify object and record actual size
  const head = await headObject(s3Key);

  const repo = AppDataSource.getRepository(GenomicFile);
  const actualSize = head.ContentLength ?? 0;
  await repo.update(fileId, {
    status:   'ready',
    uploadId: null,
    sizeBytes: actualSize,
  });

  // Fire-and-forget: convert JSON to Parquet sidecar
  const file = await repo.findOneBy({ id: fileId });
  if (file && file.filename.toLowerCase().endsWith('.json')) {
    const parquetKey = file.s3Key + '.parquet';
    await repo.update(fileId, { parquetStatus: 'converting' });

    convertJsonToParquet(BUCKET, file.s3Key, parquetKey, Number(actualSize), fileId)
      .then(() => repo.update(fileId, { parquetS3Key: parquetKey, parquetStatus: 'ready' }))
      .catch(async (err) => {
        console.error(JSON.stringify({
          tag: '[PARQUET_PIPELINE_FAILED]',
          fileId,
          s3Key: file.s3Key,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }));
        const errMsg = err instanceof Error ? err.message : String(err);
        await repo.update(fileId, { parquetStatus: 'failed', parquetError: errMsg });
      });
  }

  res.json({ ok: true });
}));

/** Abort a failed upload */
router.post('/abort', asyncWrap(async (req, res) => {
  const { fileId, uploadId, s3Key } = req.body as {
    fileId: string; uploadId: string; s3Key: string;
  };
  await abortMultipartUpload(s3Key, uploadId);

  const repo = AppDataSource.getRepository(GenomicFile);
  await repo.update(fileId, { status: 'error', uploadId: null });
  res.json({ ok: true });
}));

export default router;
