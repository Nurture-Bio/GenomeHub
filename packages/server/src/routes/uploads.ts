import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { AppDataSource } from '../app_data.js';
import { User, GenomicFile } from '../entities/index.js';
import {
  buildS3Key,
  initiateMultipartUpload,
  presignPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  headObject,
} from '../lib/s3.js';
import { isLocal, localRoot, assembleChunks } from '../lib/storage.js';
import * as edges from '../lib/edge_service.js';
import { detectFormat, isConvertible } from '@genome-hub/shared';
import { asyncWrap } from '../lib/async_wrap.js';
import { convertToParquet } from '../lib/parquet.js';
import { extractBaseProfile, hydrateAttributes, ALL_KEYS } from '../lib/data_profile.js';

const router = Router();

/** Step 1 — register file metadata and initiate S3 multipart */
router.post(
  '/initiate',
  asyncWrap(async (req, res) => {
    const {
      filename,
      contentType,
      sizeBytes,
      description,
      tags,
      organismIds,
      collectionId,
      types,
      type,
    } = req.body as {
      filename: string;
      contentType: string;
      sizeBytes: number;
      description?: string;
      tags?: string[];
      organismIds?: string[];
      collectionId?: string;
      types?: string[];
      type?: string; // backward compat: single string
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
      tags: tags ?? [],
      status: 'pending',
      s3Key: '', // filled after we have the id
      format: detectFormat(filename),
      type: types ?? (type ? [type] : ['raw']),
      uploadedBy: (res.locals.user as User)?.email ?? null,
    });
    await repo.save(file);

    const s3Key = buildS3Key(file.id, filename);

    if (isLocal) {
      file.s3Key = s3Key;
      file.uploadId = 'local';
      await repo.save(file);

      // Create edges for relationships
      const userId = (res.locals.user as User)?.id ?? null;
      if (collectionId) {
        await edges.link(
          { type: 'file', id: file.id },
          { type: 'collection', id: collectionId },
          'belongs_to',
          null,
          userId,
        );
      }
      if (organismIds?.length) {
        for (const orgId of organismIds) {
          await edges.link(
            { type: 'file', id: file.id },
            { type: 'organism', id: orgId },
            'from_organism',
            null,
            userId,
          );
        }
      }

      res.json({ fileId: file.id, uploadId: 'local', s3Key });
      return;
    }

    const uploadId = await initiateMultipartUpload(s3Key, contentType);

    file.s3Key = s3Key;
    file.uploadId = uploadId;
    await repo.save(file);

    // Create edges for relationships
    const userId = (res.locals.user as User)?.id ?? null;
    if (collectionId) {
      await edges.link(
        { type: 'file', id: file.id },
        { type: 'collection', id: collectionId },
        'belongs_to',
        null,
        userId,
      );
    }
    if (organismIds?.length) {
      for (const orgId of organismIds) {
        await edges.link(
          { type: 'file', id: file.id },
          { type: 'organism', id: orgId },
          'from_organism',
          null,
          userId,
        );
      }
    }

    res.json({ fileId: file.id, uploadId, s3Key });
  }),
);

/** Step 2 — presigned URL for one part */
router.post(
  '/part-url',
  asyncWrap(async (req, res) => {
    const { fileId, s3Key, uploadId, partNumber } = req.body as {
      fileId: string;
      s3Key: string;
      uploadId: string;
      partNumber: number;
    };

    if (isLocal) {
      // Relative URL — goes through the Vite proxy (same-origin, no CORS issues)
      const url = `/api/uploads/local-part/${fileId}/${partNumber}`;
      res.json({ url });
      return;
    }

    const url = await presignPartUrl(s3Key, uploadId, partNumber);
    res.json({ url });
  }),
);

/** Step 3 — finalize multipart and mark file ready */
router.post(
  '/complete',
  asyncWrap(async (req, res) => {
    const { fileId, uploadId, s3Key, parts } = req.body as {
      fileId: string;
      uploadId: string;
      s3Key: string;
      parts: { PartNumber: number; ETag: string }[];
    };

    const repo = AppDataSource.getRepository(GenomicFile);

    if (isLocal) {
      const actualSize = await assembleChunks(fileId, s3Key, parts.length);
      await repo.update(fileId, { status: 'ready', uploadId: null, sizeBytes: actualSize });

      // Fire-and-forget: convert to Parquet sidecar
      const file = await repo.findOneBy({ id: fileId });
      if (file && isConvertible(file.filename)) {
        const parquetKey = file.s3Key + '.parquet';
        await repo.update(fileId, { parquetStatus: 'converting' });

        convertToParquet(
          file.s3Key,
          parquetKey,
          detectFormat(file.filename),
          Number(actualSize),
          fileId,
        )
          .then(async () => {
            // Sequential: base profile → hydrate stats → mark ready.
            // Never concurrent — mergeProfileToDb must not race with the base update.
            try {
              const baseProfile = await extractBaseProfile(parquetKey);
              await repo.update(fileId, { parquetS3Key: parquetKey, dataProfile: baseProfile });
              await hydrateAttributes(parquetKey, fileId, baseProfile, ALL_KEYS);
            } catch (profileErr) {
              console.error(
                JSON.stringify({
                  tag: '[EAGER_PROFILE_FAILED]',
                  fileId,
                  parquetS3Key: parquetKey,
                  error: profileErr instanceof Error ? profileErr.message : String(profileErr),
                  timestamp: new Date().toISOString(),
                }),
              );
            }
            await repo.update(fileId, { parquetStatus: 'ready' });
          })
          .catch(async (err) => {
            console.error(
              JSON.stringify({
                tag: '[PARQUET_PIPELINE_FAILED]',
                fileId,
                s3Key: file.s3Key,
                error: err instanceof Error ? err.message : String(err),
                timestamp: new Date().toISOString(),
              }),
            );
            const errMsg = err instanceof Error ? err.message : String(err);
            await repo.update(fileId, { parquetStatus: 'failed', parquetError: errMsg });
          });
      }

      res.json({ ok: true });
      return;
    }

    await completeMultipartUpload(s3Key, uploadId, parts);

    // Verify object and record actual size
    const head = await headObject(s3Key);

    const actualSize = head.ContentLength ?? 0;
    await repo.update(fileId, {
      status: 'ready',
      uploadId: null,
      sizeBytes: actualSize,
    });

    // Fire-and-forget: convert JSON to Parquet sidecar
    const file = await repo.findOneBy({ id: fileId });
    if (file && isConvertible(file.filename)) {
      const parquetKey = file.s3Key + '.parquet';
      await repo.update(fileId, { parquetStatus: 'converting' });

      convertToParquet(
        file.s3Key,
        parquetKey,
        detectFormat(file.filename),
        Number(actualSize),
        fileId,
      )
        .then(async () => {
          try {
            const baseProfile = await extractBaseProfile(parquetKey);
            await repo.update(fileId, { parquetS3Key: parquetKey, dataProfile: baseProfile });
            await hydrateAttributes(parquetKey, fileId, baseProfile, ALL_KEYS);
          } catch (profileErr) {
            console.error(
              JSON.stringify({
                tag: '[EAGER_PROFILE_FAILED]',
                fileId,
                parquetS3Key: parquetKey,
                error: profileErr instanceof Error ? profileErr.message : String(profileErr),
                timestamp: new Date().toISOString(),
              }),
            );
          }
          await repo.update(fileId, { parquetStatus: 'ready' });
        })
        .catch(async (err) => {
          console.error(
            JSON.stringify({
              tag: '[PARQUET_PIPELINE_FAILED]',
              fileId,
              s3Key: file.s3Key,
              error: err instanceof Error ? err.message : String(err),
              timestamp: new Date().toISOString(),
            }),
          );
          const errMsg = err instanceof Error ? err.message : String(err);
          await repo.update(fileId, { parquetStatus: 'failed', parquetError: errMsg });
        });
    }

    res.json({ ok: true });
  }),
);

/** Abort a failed upload */
router.post(
  '/abort',
  asyncWrap(async (req, res) => {
    const { fileId, uploadId, s3Key } = req.body as {
      fileId: string;
      uploadId: string;
      s3Key: string;
    };

    if (isLocal) {
      // Clean up temp directory
      const tmpDir = path.join(localRoot(), 'tmp', fileId);
      await fs.rm(tmpDir, { recursive: true, force: true });
    } else {
      await abortMultipartUpload(s3Key, uploadId);
    }

    const repo = AppDataSource.getRepository(GenomicFile);
    await repo.update(fileId, { status: 'error', uploadId: null });
    res.json({ ok: true });
  }),
);

/**
 * Local part upload — mounted BEFORE the auth guard in server.ts.
 * Analogous to S3 presigned URLs: the client does plain fetch() with no Bearer token.
 */
export const localPartRouter = Router();
localPartRouter.put(
  '/:fileId/:partNumber',
  asyncWrap(async (req, res) => {
    const { fileId, partNumber } = req.params;
    const tmpDir = path.join(localRoot(), 'tmp', fileId);
    await fs.mkdir(tmpDir, { recursive: true });
    const dest = path.join(tmpDir, `part-${partNumber}`);
    await pipeline(req, createWriteStream(dest));
    res.setHeader('ETag', `"part-${partNumber}"`);
    res.sendStatus(200);
  }),
);

export default router;
