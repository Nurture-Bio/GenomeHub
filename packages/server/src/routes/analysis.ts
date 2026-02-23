/**
 * Analysis routes — proxy to SeqChain API for genomic operations.
 *
 * Express downloads data from S3, posts to SeqChain, uploads results
 * back to S3, and records provenance edges. The browser never talks
 * to SeqChain directly.
 *
 * @module
 */

import { Router } from 'express';
import { AppDataSource } from '../app_data.js';
import { User, GenomicFile } from '../entities/index.js';
import { getObjectBody, putObject, buildS3Key, headObject } from '../lib/s3.js';
import * as edges from '../lib/edge_service.js';
import { asyncWrap } from '../lib/async_wrap.js';

const router = Router();

const SEQCHAIN_URL = process.env.SEQCHAIN_URL ?? 'http://localhost:8001';

// ─── Overlay ─────────────────────────────────────────────

router.post('/overlay', asyncWrap(async (req, res) => {
  const { queryFileId, referenceFileId, nameTag } = req.body as {
    queryFileId: string;
    referenceFileId: string;
    nameTag?: string;
  };

  if (!queryFileId || !referenceFileId) {
    res.status(400).json({ error: 'queryFileId and referenceFileId required' });
    return;
  }

  const repo = AppDataSource.getRepository(GenomicFile);
  const [queryFile, refFile] = await Promise.all([
    repo.findOneBy({ id: queryFileId }),
    repo.findOneBy({ id: referenceFileId }),
  ]);

  if (!queryFile) { res.status(404).json({ error: 'query file not found' }); return; }
  if (!refFile) { res.status(404).json({ error: 'reference file not found' }); return; }

  if (queryFile.format !== 'json' || refFile.format !== 'json') {
    res.status(400).json({ error: 'both files must be JSON format' });
    return;
  }

  // 1. Download both JSONs from S3
  const [queryBuf, refBuf] = await Promise.all([
    getObjectBody(queryFile.s3Key),
    getObjectBody(refFile.s3Key),
  ]);

  const queryData = JSON.parse(queryBuf.toString('utf-8'));
  const refData = JSON.parse(refBuf.toString('utf-8'));

  // 2. Upload both to SeqChain as inline tracks
  const [queryTrackRes, refTrackRes] = await Promise.all([
    fetch(`${SEQCHAIN_URL}/api/tracks/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: queryFile.filename, regions: queryData }),
    }),
    fetch(`${SEQCHAIN_URL}/api/tracks/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: refFile.filename, regions: refData }),
    }),
  ]);

  if (!queryTrackRes.ok || !refTrackRes.ok) {
    res.status(502).json({ error: 'Failed to upload tracks to SeqChain' });
    return;
  }

  const { track_id: queryTrackId } = await queryTrackRes.json() as { track_id: string };
  const { track_id: refTrackId } = await refTrackRes.json() as { track_id: string };

  // 3. Run overlay
  const overlayRes = await fetch(`${SEQCHAIN_URL}/api/operations/overlay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query_track_id: queryTrackId,
      reference_track_id: refTrackId,
      name_tag: nameTag ?? 'feature_type',
    }),
  });

  if (!overlayRes.ok) {
    const err = await overlayRes.json().catch(() => null);
    res.status(502).json({ error: err?.detail ?? 'SeqChain overlay failed' });
    return;
  }

  const { track_id: resultTrackId } = await overlayRes.json() as { track_id: string };

  // 4. Fetch result data
  const dataRes = await fetch(`${SEQCHAIN_URL}/api/tracks/${resultTrackId}/data`);
  if (!dataRes.ok) {
    res.status(502).json({ error: 'Failed to fetch overlay result from SeqChain' });
    return;
  }
  const resultData = await dataRes.json();

  // 5. Upload result to S3
  const resultFilename = `overlay_${queryFile.filename.replace(/\.json$/i, '')}_x_${refFile.filename.replace(/\.json$/i, '')}.json`;
  const resultFile = repo.create({
    filename: resultFilename,
    s3Key: '', // placeholder, set after we know the ID
    sizeBytes: 0,
    format: 'json',
    type: ['track', 'analysis'],
    status: 'ready',
    description: `Overlay of ${queryFile.filename} (query) with ${refFile.filename} (reference)`,
    uploadedBy: (res.locals.user as User)?.name ?? null,
  });
  await repo.save(resultFile);

  const resultJson = JSON.stringify(resultData, null, 2);
  const s3Key = buildS3Key(resultFile.id, resultFilename);
  await putObject(s3Key, resultJson, 'application/json');

  // Update file with final s3Key and size
  resultFile.s3Key = s3Key;
  resultFile.sizeBytes = Buffer.byteLength(resultJson);
  await repo.save(resultFile);

  // 6. Create provenance edges
  const userId = (res.locals.user as User)?.id ?? null;
  await Promise.all([
    edges.link(
      { type: 'file', id: resultFile.id },
      { type: 'file', id: queryFileId },
      'overlaid_from',
      { role: 'query' },
      userId,
    ),
    edges.link(
      { type: 'file', id: resultFile.id },
      { type: 'file', id: referenceFileId },
      'overlaid_from',
      { role: 'reference' },
      userId,
    ),
  ]);

  res.status(201).json({
    fileId: resultFile.id,
    filename: resultFilename,
  });
}));

export default router;
