import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { User, GenomicFile } from '../entities/index.js';
import {
  buildS3Key, initiateMultipartUpload, presignPartUrl,
  completeMultipartUpload, abortMultipartUpload, headObject,
} from '../lib/s3.js';
import * as edges from '../lib/edge_service.js';
import { detectFormat } from '@genome-hub/shared';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

/** Step 1 — register file metadata and initiate S3 multipart */
router.post('/initiate', asyncWrap(async (req, res) => {
  const { filename, projectId, contentType, sizeBytes, description, tags, organismId, experimentId, datasetId } =
    req.body as {
      filename:    string;
      projectId:   string;
      contentType: string;
      sizeBytes:   number;
      description?: string;
      tags?: string[];
      organismId?: string;
      experimentId?: string;
      datasetId?: string;
    };

  if (!filename || !projectId) {
    res.status(400).json({ error: 'filename and projectId required' });
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
    uploadedBy: (res.locals.user as User)?.email ?? null,
  });
  await repo.save(file);

  const s3Key   = buildS3Key(projectId, file.id, filename);
  const uploadId = await initiateMultipartUpload(s3Key, contentType);

  file.s3Key    = s3Key;
  file.uploadId = uploadId;
  await repo.save(file);

  // Create edges for relationships
  const userId = (res.locals.user as User)?.id ?? null;
  await edges.link({ type: 'file', id: file.id }, { type: 'project', id: projectId }, 'belongs_to', null, userId);
  if (experimentId) {
    await edges.link({ type: 'file', id: file.id }, { type: 'experiment', id: experimentId }, 'belongs_to', null, userId);
  }
  if (datasetId) {
    await edges.link({ type: 'file', id: file.id }, { type: 'dataset', id: datasetId }, 'belongs_to', null, userId);
  }
  if (organismId) {
    await edges.link({ type: 'file', id: file.id }, { type: 'organism', id: organismId }, 'from_organism', null, userId);
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
  await repo.update(fileId, {
    status:   'ready',
    uploadId: null,
    sizeBytes: head.ContentLength ?? 0,
  });

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
