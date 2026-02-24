import { Router } from 'express';
import { randomUUID } from 'crypto';
import { AppDataSource } from '../app_data.js';
import { Engine, GenomicFile, User } from '../entities/index.js';
import { asyncWrap } from '../lib/async_wrap.js';
import { getObject, putObject, buildS3Key } from '../lib/s3.js';
import * as edges from '../lib/edge_service.js';

const router = Router();

// ── CRUD ──────────────────────────────────────────────────

router.get('/', asyncWrap(async (_req, res) => {
  const repo = AppDataSource.getRepository(Engine);
  const engines = await repo.find({ order: { name: 'ASC' } });

  const results = await Promise.all(engines.map(async (engine) => {
    let status: 'ok' | 'error' | 'unavailable' = 'unavailable';
    try {
      const r = await fetch(`${engine.url}/api/health`, { signal: AbortSignal.timeout(3000) });
      const body = await r.json();
      status = body.status === 'ok' ? 'ok' : 'error';
    } catch { /* unavailable */ }
    return { id: engine.id, name: engine.name, url: engine.url, status, createdAt: engine.createdAt };
  }));

  res.json(results);
}));

router.post('/', asyncWrap(async (req, res) => {
  const { name, url } = req.body as { name?: string; url?: string };
  if (!name?.trim() || !url?.trim()) {
    res.status(400).json({ error: 'name and url required' });
    return;
  }
  const repo = AppDataSource.getRepository(Engine);
  const engine = repo.create({ name: name.trim(), url: url.trim() });
  await repo.save(engine);
  res.status(201).json(engine);
}));

router.put('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Engine);
  const engine = await repo.findOneBy({ id: req.params.id });
  if (!engine) { res.status(404).json({ error: 'not found' }); return; }
  const { name, url } = req.body as { name?: string; url?: string };
  if (name !== undefined) engine.name = name;
  if (url !== undefined) engine.url = url;
  await repo.save(engine);
  res.json(engine);
}));

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Engine);
  const engine = await repo.findOneBy({ id: req.params.id });
  if (!engine) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(engine);
  res.json({ ok: true });
}));

// ── Method discovery ──────────────────────────────────────

router.get('/:id/methods', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Engine);
  const engine = await repo.findOneBy({ id: req.params.id });
  if (!engine) { res.status(404).json({ error: 'engine not found' }); return; }

  const r = await fetch(`${engine.url}/api/methods`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) {
    res.status(502).json({ error: `Engine returned ${r.status}` });
    return;
  }
  const methods = await r.json();
  res.json(methods);
}));

// ── Method dispatch (orchestrate full data flow) ──────────

router.post('/:id/methods/:methodId', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Engine);
  const fileRepo = AppDataSource.getRepository(GenomicFile);
  const engine = await repo.findOneBy({ id: req.params.id });
  if (!engine) { res.status(404).json({ error: 'engine not found' }); return; }

  const { methodId } = req.params;
  const body = req.body as Record<string, string>;
  const userId = (res.locals.user as User)?.id ?? null;

  // 1. Fetch method schema from engine
  const schemaRes = await fetch(`${engine.url}/api/methods/${methodId}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!schemaRes.ok) {
    res.status(502).json({ error: `Method schema fetch failed: ${schemaRes.status}` });
    return;
  }
  const schema = await schemaRes.json() as {
    parameters: { name: string; type: string; required: boolean }[];
  };

  // 2. For each file param: download from S3, upload to engine
  const dispatchBody: Record<string, string> = {};
  const inputFileIds: string[] = [];

  for (const param of schema.parameters) {
    const value = body[param.name];
    if (value === undefined && param.required) {
      res.status(400).json({ error: `Missing required parameter: ${param.name}` });
      return;
    }
    if (value === undefined) continue;

    if (param.type === 'file') {
      // value is a GenomicFile ID — download bytes, forward to engine
      const file = await fileRepo.findOneBy({ id: value });
      if (!file) {
        res.status(404).json({ error: `File ${value} not found` });
        return;
      }
      inputFileIds.push(file.id);

      const bytes = await getObject(file.s3Key);
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(bytes)]), file.filename);

      const uploadRes = await fetch(`${engine.url}/api/files/upload`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      if (!uploadRes.ok) {
        const errBody = await uploadRes.text();
        res.status(502).json({ error: `Engine upload failed: ${errBody}` });
        return;
      }
      const { id: engineFileId } = await uploadRes.json() as { id: string };
      dispatchBody[param.name] = engineFileId;
    } else {
      dispatchBody[param.name] = value;
    }
  }

  // 3. Call the method on the engine
  const methodRes = await fetch(`${engine.url}/api/methods/${methodId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dispatchBody),
    signal: AbortSignal.timeout(60000),
  });
  if (!methodRes.ok) {
    const errBody = await methodRes.text();
    res.status(502).json({ error: `Method execution failed: ${errBody}` });
    return;
  }
  const { id: engineResultId } = await methodRes.json() as { id: string };

  // 4. Fetch result as JSON
  const dataRes = await fetch(
    `${engine.url}/api/tracks/${engineResultId}/data`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!dataRes.ok) {
    res.status(502).json({ error: `Result fetch failed: ${dataRes.status}` });
    return;
  }
  const resultData = await dataRes.json();
  const resultBytes = Buffer.from(JSON.stringify(resultData, null, 2));

  // 5. Create GenomicFile record, upload to S3, create provenance edges
  const resultFileId = randomUUID();
  const filename = `${methodId}_result.json`;
  const s3Key = buildS3Key(resultFileId, filename);

  await putObject(s3Key, resultBytes, 'application/json');

  const resultFile = fileRepo.create({
    id:         resultFileId,
    filename,
    s3Key,
    sizeBytes:  resultBytes.length,
    format:     'json',
    type:       ['derived'],
    status:     'ready',
    description: `${engine.name} ${methodId} result`,
    tags:       [`engine:${engine.name}`, `method:${methodId}`],
    uploadedBy: (res.locals.user as User)?.email ?? null,
  });
  await fileRepo.save(resultFile);

  // Provenance: result -[derived_from]-> each input file
  for (const inputId of inputFileIds) {
    await edges.link(
      { type: 'file', id: resultFile.id },
      { type: 'file', id: inputId },
      'derived_from',
      { engine: engine.name, method: methodId },
      userId,
    );
  }

  res.json({ fileId: resultFile.id, filename: resultFile.filename });
}));

export default router;
