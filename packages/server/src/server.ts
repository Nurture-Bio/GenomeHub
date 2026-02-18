/**
 * GenomeHub server.
 *
 * Express API that:
 *  - Serves the Vite-built client from /dist/client
 *  - Exposes REST endpoints for files, projects, and S3 multipart uploads
 *  - Never buffers file payloads — the browser uploads directly to S3
 *    via presigned multipart URLs; the server only coordinates metadata.
 *
 * @module
 */

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { createServer }   from 'http';
import path               from 'path';
import { fileURLToPath }  from 'url';
import { AppDataSource }  from './app_data.js';
import { Project, GenomicFile } from './entities/index.js';
import {
  buildS3Key, initiateMultipartUpload, presignPartUrl,
  completeMultipartUpload, abortMultipartUpload,
  deleteObject, presignDownloadUrl, headObject,
} from './lib/s3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app       = express();
const server    = createServer(app);

app.use(express.json());

// ─── Helper ────────────────────────────────────────────────

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
}

// ─── Projects ──────────────────────────────────────────────

app.get('/api/projects', asyncWrap(async (_req, res) => {
  const repo = AppDataSource.getRepository(Project);
  const prjs = await repo.find({ order: { createdAt: 'DESC' } });

  // Enrich with file counts and storage totals
  const fileRepo = AppDataSource.getRepository(GenomicFile);
  const stats = await fileRepo
    .createQueryBuilder('f')
    .select('f.project_id', 'projectId')
    .addSelect('COUNT(*)', 'fileCount')
    .addSelect('SUM(f.size_bytes)', 'totalBytes')
    .groupBy('f.project_id')
    .getRawMany<{ projectId: string; fileCount: string; totalBytes: string }>();

  const statsMap = new Map(stats.map(s => [s.projectId, s]));

  res.json(prjs.map(p => ({
    ...p,
    fileCount:  parseInt(statsMap.get(p.id)?.fileCount  ?? '0'),
    totalBytes: parseInt(statsMap.get(p.id)?.totalBytes ?? '0'),
  })));
}));

app.post('/api/projects', asyncWrap(async (req, res) => {
  const { name, description } = req.body as { name: string; description?: string };
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  const repo = AppDataSource.getRepository(Project);
  const prj  = repo.create({ name, description: description ?? null });
  await repo.save(prj);
  res.status(201).json(prj);
}));

// ─── Files ─────────────────────────────────────────────────

app.get('/api/files', asyncWrap(async (req, res) => {
  const { projectId } = req.query as { projectId?: string };
  const repo = AppDataSource.getRepository(GenomicFile);

  const qb = repo.createQueryBuilder('f')
    .innerJoinAndSelect('f.project', 'p')
    .orderBy('f.uploadedAt', 'DESC');

  if (projectId) qb.where('f.project_id = :projectId', { projectId });

  const files = await qb.getMany();
  res.json(files.map(f => ({
    id:          f.id,
    projectId:   f.projectId,
    projectName: f.project.name,
    filename:    f.filename,
    s3Key:       f.s3Key,
    sizeBytes:   Number(f.sizeBytes),
    format:      f.format,
    md5:         f.md5,
    status:      f.status,
    uploadedAt:  f.uploadedAt,
    description: f.description,
    tags:        f.tags,
  })));
}));

app.delete('/api/files/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(GenomicFile);
  const file = await repo.findOneBy({ id: req.params.id });
  if (!file) { res.status(404).json({ error: 'not found' }); return; }

  await deleteObject(file.s3Key);
  await repo.remove(file);
  res.json({ ok: true });
}));

app.get('/api/files/:id/download', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(GenomicFile);
  const file = await repo.findOneBy({ id: req.params.id });
  if (!file) { res.status(404).json({ error: 'not found' }); return; }

  const url = await presignDownloadUrl(file.s3Key, file.filename);
  res.json({ url });
}));

// ─── Storage stats ─────────────────────────────────────────

app.get('/api/stats', asyncWrap(async (_req, res) => {
  const repo   = AppDataSource.getRepository(GenomicFile);
  const totals = await repo.createQueryBuilder('f')
    .select('COUNT(*)', 'totalFiles')
    .addSelect('SUM(f.size_bytes)', 'totalBytes')
    .where("f.status = 'ready'")
    .getRawOne<{ totalFiles: string; totalBytes: string }>();

  const byFmt = await repo.createQueryBuilder('f')
    .select('f.format', 'format')
    .addSelect('COUNT(*)',           'count')
    .addSelect('SUM(f.size_bytes)',  'bytes')
    .where("f.status = 'ready'")
    .groupBy('f.format')
    .orderBy('bytes', 'DESC')
    .getRawMany<{ format: string; count: string; bytes: string }>();

  res.json({
    totalFiles:  parseInt(totals?.totalFiles  ?? '0'),
    totalBytes:  parseInt(totals?.totalBytes  ?? '0'),
    byFormat: byFmt.map(r => ({
      format: r.format,
      count:  parseInt(r.count),
      bytes:  parseInt(r.bytes),
    })),
  });
}));

// ─── Multipart uploads ─────────────────────────────────────

/** Step 1 — register file metadata and initiate S3 multipart */
app.post('/api/uploads/initiate', asyncWrap(async (req, res) => {
  const { filename, projectId, contentType, sizeBytes, description, tags } =
    req.body as {
      filename:    string;
      projectId:   string;
      contentType: string;
      sizeBytes:   number;
      description?: string;
      tags?: string[];
    };

  if (!filename || !projectId) {
    res.status(400).json({ error: 'filename and projectId required' });
    return;
  }

  const repo = AppDataSource.getRepository(GenomicFile);
  const file = repo.create({
    projectId,
    filename,
    sizeBytes,
    description: description ?? null,
    tags:   tags ?? [],
    status: 'pending',
    s3Key:  '',   // filled after we have the id
    format: detectFormat(filename),
  });
  await repo.save(file);

  const s3Key   = buildS3Key(projectId, file.id, filename);
  const uploadId = await initiateMultipartUpload(s3Key, contentType);

  file.s3Key    = s3Key;
  file.uploadId = uploadId;
  await repo.save(file);

  res.json({ fileId: file.id, uploadId, s3Key });
}));

/** Step 2 — presigned URL for one part */
app.post('/api/uploads/part-url', asyncWrap(async (req, res) => {
  const { s3Key, uploadId, partNumber } =
    req.body as { fileId: string; s3Key: string; uploadId: string; partNumber: number };

  const url = await presignPartUrl(s3Key, uploadId, partNumber);
  res.json({ url });
}));

/** Step 3 — finalize multipart and mark file ready */
app.post('/api/uploads/complete', asyncWrap(async (req, res) => {
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
app.post('/api/uploads/abort', asyncWrap(async (req, res) => {
  const { fileId, uploadId, s3Key } = req.body as {
    fileId: string; uploadId: string; s3Key: string;
  };
  await abortMultipartUpload(s3Key, uploadId);

  const repo = AppDataSource.getRepository(GenomicFile);
  await repo.update(fileId, { status: 'error', uploadId: null });
  res.json({ ok: true });
}));

// ─── Serve client ──────────────────────────────────────────

const clientDist = path.join(__dirname, '..', '..', '..', 'dist', 'client');
app.use(express.static(clientDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ─── Error handler ─────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ─── Boot ──────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000');

async function main() {
  await AppDataSource.initialize();
  console.log('Database connected');

  server.listen(PORT, () => {
    console.log(`GenomeHub listening on http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

// ─── Inline format helper (mirrors client lib/formats.ts) ──

function detectFormat(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.fastq') || lower.endsWith('.fastq.gz') ||
      lower.endsWith('.fq')    || lower.endsWith('.fq.gz'))     return 'fastq';
  if (lower.endsWith('.bam'))                                    return 'bam';
  if (lower.endsWith('.cram'))                                   return 'cram';
  if (lower.endsWith('.vcf') || lower.endsWith('.vcf.gz'))      return 'vcf';
  if (lower.endsWith('.bcf'))                                    return 'bcf';
  if (lower.endsWith('.bed') || lower.endsWith('.bed.gz'))      return 'bed';
  if (lower.endsWith('.gff') || lower.endsWith('.gff3') ||
      lower.endsWith('.gff.gz'))                                 return 'gff';
  if (lower.endsWith('.gtf') || lower.endsWith('.gtf.gz'))      return 'gtf';
  if (lower.endsWith('.fa')  || lower.endsWith('.fasta') ||
      lower.endsWith('.fa.gz') || lower.endsWith('.fasta.gz'))  return 'fasta';
  if (lower.endsWith('.sam'))                                    return 'sam';
  if (lower.endsWith('.bw')  || lower.endsWith('.bigwig'))      return 'bigwig';
  if (lower.endsWith('.bb')  || lower.endsWith('.bigbed'))      return 'bigbed';
  return 'other';
}
