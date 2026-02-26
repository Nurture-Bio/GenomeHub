import { Readable } from 'stream';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { AppDataSource } from '../app_data.js';
import { Engine, GenomicFile, User } from '../entities/index.js';
import { asyncWrap } from '../lib/async_wrap.js';
import { s3, BUCKET, putObjectStream, buildS3Key } from '../lib/s3.js';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { detectFormat } from '@genome-hub/shared';
import * as edges from '../lib/edge_service.js';

const router = Router();

// ── Helpers ───────────────────────────────────────────────

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Extract filename and content-type from a result response. */
function parseResultMeta(
  headers: Headers,
  methodId: string,
): { filename: string; contentType: string } {
  const cd = headers.get('content-disposition');
  if (cd) {
    const m = cd.match(/filename[^;=\n]*=(?:['"]([^'"]*)|([^;\n]*))/i);
    const fn = (m?.[1] ?? m?.[2] ?? '').trim();
    if (fn) return { filename: fn, contentType: headers.get('content-type') ?? 'application/octet-stream' };
  }
  const ct = headers.get('content-type') ?? 'application/octet-stream';
  const extMap: Record<string, string> = {
    'application/json':          'json',
    'text/plain':                'txt',
    'text/csv':                  'csv',
    'text/tab-separated-values': 'tsv',
  };
  const ext = extMap[ct.split(';')[0].trim()] ?? 'bin';
  return { filename: `${methodId}_result.${ext}`, contentType: ct };
}

// ── Async job registry ────────────────────────────────────
// In-memory — jobs are tracked within the server process lifetime.

interface EngineJob {
  status:   'queued' | 'running' | 'complete' | 'failed';
  progress: { pct_complete: number | null; rate_per_sec: number | null; eta_seconds: number | null };
  error:    string | null;
  fileId?:  string;
  filename?: string;
}

const jobRegistry = new Map<string, EngineJob>();

async function runAsyncJob(
  hubJobId:     string,
  engineJobId:  string,
  engineUrl:    string,
  engineName:   string,
  methodId:     string,
  inputFileIds: string[],
  uploadedBy:   string | null,
  userId:       string | null,
): Promise<void> {
  const job = jobRegistry.get(hubJobId)!;
  const fileRepo = AppDataSource.getRepository(GenomicFile);

  try {
    job.status = 'running';

    // Poll engine until complete or failed
    for (;;) {
      await sleep(2000);

      const pollRes = await fetch(`${engineUrl}/api/jobs/${engineJobId}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!pollRes.ok) throw new Error(`Poll failed: ${pollRes.status}`);

      const poll = await pollRes.json() as {
        status:   'queued' | 'running' | 'complete' | 'failed';
        progress: { pct_complete: number | null; rate_per_sec: number | null; eta_seconds: number | null };
        error:    string | null;
      };

      job.progress = poll.progress;

      if (poll.status === 'failed') throw new Error(poll.error ?? 'Engine job failed');
      if (poll.status === 'complete') break;

      job.status = poll.status; // 'queued' | 'running'
    }

    // Fetch result stream from engine, pipe directly to S3
    const streamRes = await fetch(`${engineUrl}/api/jobs/${engineJobId}/stream`);
    if (!streamRes.ok) throw new Error(`Stream fetch failed: ${streamRes.status}`);

    const { filename, contentType } = parseResultMeta(streamRes.headers, methodId);
    const resultFileId = randomUUID();
    const s3Key = buildS3Key(resultFileId, filename);

    await putObjectStream(
      s3Key,
      Readable.fromWeb(streamRes.body! as import('stream/web').ReadableStream),
      contentType,
    );

    const fmt = detectFormat(filename);
    const resultFile = fileRepo.create({
      id:          resultFileId,
      filename,
      s3Key,
      sizeBytes:   0,
      format:      fmt,
      type:        ['derived'],
      status:      'ready',
      description: `${engineName} ${methodId} result`,
      tags:        [`engine:${engineName}`, `method:${methodId}`],
      uploadedBy,
    });
    await fileRepo.save(resultFile);

    for (const inputId of inputFileIds) {
      await edges.link(
        { type: 'file', id: resultFile.id },
        { type: 'file', id: inputId },
        'derived_from',
        { engine: engineName, method: methodId },
        userId,
      );
    }

    job.status   = 'complete';
    job.fileId   = resultFile.id;
    job.filename = resultFile.filename;
  } catch (err) {
    job.status = 'failed';
    job.error  = err instanceof Error ? err.message : 'Unexpected error';
  }
}

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

// ── Async job polling ─────────────────────────────────────

router.get('/jobs/:jobId', asyncWrap(async (req, res) => {
  const job = jobRegistry.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: 'job not found' }); return; }
  res.json(job);
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
//
// Files stream S3 → engine. Results stream engine → S3.
// Node heap stays small regardless of file size.

router.post('/:id/methods/:methodId', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Engine);
  const fileRepo = AppDataSource.getRepository(GenomicFile);
  const engine = await repo.findOneBy({ id: req.params.id });
  if (!engine) { res.status(404).json({ error: 'engine not found' }); return; }

  const { methodId } = req.params;
  const body = req.body as Record<string, string>;
  const userId = (res.locals.user as User)?.id ?? null;
  const uploadedBy = (res.locals.user as User)?.email ?? null;

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

  // 2. For each file param: stream from S3 to engine (zero-buffer)
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
      const file = await fileRepo.findOneBy({ id: value });
      if (!file) {
        res.status(404).json({ error: `File ${value} not found` });
        return;
      }
      inputFileIds.push(file.id);

      const boundary = `concertina${randomUUID().replace(/-/g, '')}`;
      const encoder  = new TextEncoder();
      const prelude  = encoder.encode(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n` +
        `\r\n`,
      );
      const epilogue = encoder.encode(`\r\n--${boundary}--\r\n`);

      const s3Res  = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: file.s3Key }));
      const s3Body = s3Res.Body!.transformToWebStream() as ReadableStream<Uint8Array>;

      const multipartStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(prelude);
          const reader = s3Body.getReader();
          try {
            for (;;) {
              const { done, value: chunk } = await reader.read();
              if (done) break;
              controller.enqueue(chunk);
            }
          } finally {
            reader.releaseLock();
          }
          controller.enqueue(epilogue);
          controller.close();
        },
      });

      const uploadRes = await fetch(`${engine.url}/api/files/upload`, {
        method:  'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body:    multipartStream,
        duplex:  'half',
      } as RequestInit & { duplex: string });

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
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(dispatchBody),
    signal:  AbortSignal.timeout(30000),
  });
  if (!methodRes.ok) {
    const errBody = await methodRes.text();
    res.status(502).json({ error: `Method execution failed: ${errBody}` });
    return;
  }

  // 4a. Async (202): register hub job, start background poll, return immediately
  if (methodRes.status === 202) {
    const { job_id: engineJobId } = await methodRes.json() as { job_id: string };
    const hubJobId = randomUUID();

    jobRegistry.set(hubJobId, {
      status:   'queued',
      progress: { pct_complete: null, rate_per_sec: null, eta_seconds: null },
      error:    null,
    });

    // Fire and forget — client polls GET /api/engines/jobs/:jobId
    runAsyncJob(hubJobId, engineJobId, engine.url, engine.name, methodId, inputFileIds, uploadedBy, userId)
      .catch(() => { /* error already captured in job.error */ });

    res.status(202).json({ jobId: hubJobId });
    return;
  }

  // 4b. Sync (200): pipe body stream directly to S3
  const { filename, contentType } = parseResultMeta(methodRes.headers, methodId);
  const resultFileId = randomUUID();
  const s3Key = buildS3Key(resultFileId, filename);

  await putObjectStream(
    s3Key,
    Readable.fromWeb(methodRes.body! as import('stream/web').ReadableStream),
    contentType,
  );

  // 5. Create GenomicFile record and provenance edges
  const fmt = detectFormat(filename);
  const resultFile = fileRepo.create({
    id:          resultFileId,
    filename,
    s3Key,
    sizeBytes:   0,
    format:      fmt,
    type:        ['derived'],
    status:      'ready',
    description: `${engine.name} ${methodId} result`,
    tags:        [`engine:${engine.name}`, `method:${methodId}`],
    uploadedBy,
  });
  await fileRepo.save(resultFile);

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
