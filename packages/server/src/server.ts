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
import crypto              from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import { createServer }    from 'http';
import path                from 'path';
import { fileURLToPath }   from 'url';
import { AppDataSource }   from './app_data.js';
import { User, Project, Organism, Experiment, GenomicFile } from './entities/index.js';
import {
  buildS3Key, initiateMultipartUpload, presignPartUrl,
  completeMultipartUpload, abortMultipartUpload,
  deleteObject, presignDownloadUrl, headObject,
} from './lib/s3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app       = express();
const server    = createServer(app);

app.set('trust proxy', 1);
app.use(express.json());

// Prevent CloudFront from caching API responses
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ─── Helper ────────────────────────────────────────────────

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
}

// ─── Auth helpers ───────────────────────────────────────────

/** Look up the authenticated user from the Authorization header. */
async function resolveUser(req: Request): Promise<User | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  if (!token) return null;
  const repo = AppDataSource.getRepository(User);
  return repo.findOneBy({ authToken: token });
}

// ─── Auth routes ────────────────────────────────────────────

app.post('/api/auth/google', asyncWrap(async (req, res) => {
  const { accessToken } = req.body as { accessToken: string };
  if (!accessToken) { res.status(400).json({ error: 'accessToken required' }); return; }

  // Exchange access token for user info from Google
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!infoRes.ok) { res.status(401).json({ error: 'invalid token' }); return; }

  const info = await infoRes.json() as {
    sub: string; email: string; name?: string;
    given_name?: string; family_name?: string; picture?: string; hd?: string;
  };

  if (info.hd !== 'nurture.bio') {
    res.status(403).json({ error: 'Only nurture.bio accounts are allowed' });
    return;
  }

  const userRepo = AppDataSource.getRepository(User);
  const authToken = crypto.randomBytes(32).toString('hex');

  let user = await userRepo.findOneBy({ googleId: info.sub });
  if (user) {
    user.name = info.name ?? user.name;
    user.givenName = info.given_name ?? user.givenName;
    user.familyName = info.family_name ?? user.familyName;
    user.picture = info.picture ?? user.picture;
    user.lastLoginAt = new Date();
    user.authToken = authToken;
    await userRepo.save(user);
  } else {
    user = userRepo.create({
      googleId: info.sub,
      email: info.email,
      name: info.name ?? info.email,
      givenName: info.given_name ?? null,
      familyName: info.family_name ?? null,
      picture: info.picture ?? null,
      hd: info.hd ?? null,
      lastLoginAt: new Date(),
      authToken,
    });
    await userRepo.save(user);
  }

  res.json({ id: user.id, email: user.email, name: user.name, picture: user.picture, token: authToken });
}));

app.get('/api/auth/me', asyncWrap(async (req, res) => {
  const user = await resolveUser(req);
  if (!user) { res.status(401).json({ error: 'not authenticated' }); return; }
  res.json({ id: user.id, email: user.email, name: user.name, picture: user.picture });
}));

app.post('/api/auth/logout', asyncWrap(async (req, res) => {
  const user = await resolveUser(req);
  if (user) {
    user.authToken = null;
    await AppDataSource.getRepository(User).save(user);
  }
  res.json({ ok: true });
}));

// ─── Auth guard ─────────────────────────────────────────────

app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  resolveUser(req).then(user => {
    if (!user) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    res.locals.user = user;
    next();
  }).catch(next);
});

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

// ─── Organisms ────────────────────────────────────────────

app.get('/api/organisms', asyncWrap(async (_req, res) => {
  const repo = AppDataSource.getRepository(Organism);
  const organisms = await repo.find({ order: { createdAt: 'DESC' } });

  const fileRepo = AppDataSource.getRepository(GenomicFile);
  const fileCounts = await fileRepo
    .createQueryBuilder('f')
    .select('f.organism_id', 'organismId')
    .addSelect('COUNT(*)', 'fileCount')
    .where('f.organism_id IS NOT NULL')
    .groupBy('f.organism_id')
    .getRawMany<{ organismId: string; fileCount: string }>();
  const fileMap = new Map(fileCounts.map(s => [s.organismId, parseInt(s.fileCount)]));

  const expRepo = AppDataSource.getRepository(Experiment);
  const expCounts = await expRepo
    .createQueryBuilder('e')
    .select('e.organism_id', 'organismId')
    .addSelect('COUNT(*)', 'experimentCount')
    .where('e.organism_id IS NOT NULL')
    .groupBy('e.organism_id')
    .getRawMany<{ organismId: string; experimentCount: string }>();
  const expMap = new Map(expCounts.map(s => [s.organismId, parseInt(s.experimentCount)]));

  res.json(organisms.map(o => ({
    ...o,
    displayName: `${o.genus.charAt(0)}. ${o.species}${o.strain ? ' ' + o.strain : ''}`,
    fileCount: fileMap.get(o.id) ?? 0,
    experimentCount: expMap.get(o.id) ?? 0,
  })));
}));

app.post('/api/organisms', asyncWrap(async (req, res) => {
  const { genus, species, strain, commonName, ncbiTaxId, referenceGenome } = req.body as {
    genus: string; species: string; strain?: string; commonName?: string;
    ncbiTaxId?: number; referenceGenome?: string;
  };
  if (!genus || !species) { res.status(400).json({ error: 'genus and species required' }); return; }

  const repo = AppDataSource.getRepository(Organism);
  const org = repo.create({
    genus, species,
    strain: strain ?? null,
    commonName: commonName ?? null,
    ncbiTaxId: ncbiTaxId ?? null,
    referenceGenome: referenceGenome ?? null,
  });
  await repo.save(org);
  res.status(201).json(org);
}));

app.delete('/api/organisms/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Organism);
  const org = await repo.findOneBy({ id: req.params.id });
  if (!org) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(org);
  res.json({ ok: true });
}));

// ─── Experiments ──────────────────────────────────────────

app.get('/api/experiments', asyncWrap(async (req, res) => {
  const { projectId, organismId } = req.query as { projectId?: string; organismId?: string };
  const repo = AppDataSource.getRepository(Experiment);

  const qb = repo.createQueryBuilder('e')
    .leftJoinAndSelect('e.project', 'p')
    .leftJoinAndSelect('e.organism', 'o')
    .orderBy('e.createdAt', 'DESC');

  if (projectId) qb.andWhere('e.project_id = :projectId', { projectId });
  if (organismId) qb.andWhere('e.organism_id = :organismId', { organismId });

  const experiments = await qb.getMany();

  const fileRepo = AppDataSource.getRepository(GenomicFile);
  const fileCounts = await fileRepo
    .createQueryBuilder('f')
    .select('f.experiment_id', 'experimentId')
    .addSelect('COUNT(*)', 'fileCount')
    .where('f.experiment_id IS NOT NULL')
    .groupBy('f.experiment_id')
    .getRawMany<{ experimentId: string; fileCount: string }>();
  const fileMap = new Map(fileCounts.map(s => [s.experimentId, parseInt(s.fileCount)]));

  res.json(experiments.map(e => ({
    id: e.id,
    name: e.name,
    description: e.description,
    technique: e.technique,
    experimentDate: e.experimentDate,
    createdBy: e.createdBy,
    projectId: e.projectId,
    projectName: e.project?.name ?? null,
    organismId: e.organismId,
    organismDisplay: e.organism
      ? `${e.organism.genus.charAt(0)}. ${e.organism.species}${e.organism.strain ? ' ' + e.organism.strain : ''}`
      : null,
    fileCount: fileMap.get(e.id) ?? 0,
    createdAt: e.createdAt,
  })));
}));

app.post('/api/experiments', asyncWrap(async (req, res) => {
  const { name, technique, projectId, description, experimentDate, createdBy, organismId } = req.body as {
    name: string; technique: string; projectId: string;
    description?: string; experimentDate?: string; createdBy?: string; organismId?: string;
  };
  if (!name || !technique || !projectId) {
    res.status(400).json({ error: 'name, technique, and projectId required' }); return;
  }

  const repo = AppDataSource.getRepository(Experiment);
  const exp = repo.create({
    name, technique, projectId,
    description: description ?? null,
    experimentDate: experimentDate ?? null,
    createdBy: (res.locals.user as User)?.email ?? createdBy ?? null,
    organismId: organismId ?? null,
  });
  await repo.save(exp);
  res.status(201).json(exp);
}));

app.delete('/api/experiments/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Experiment);
  const exp = await repo.findOneBy({ id: req.params.id });
  if (!exp) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(exp);
  res.json({ ok: true });
}));

// ─── Files ─────────────────────────────────────────────────

app.get('/api/files', asyncWrap(async (req, res) => {
  const { projectId, organismId, experimentId } = req.query as {
    projectId?: string; organismId?: string; experimentId?: string;
  };
  const repo = AppDataSource.getRepository(GenomicFile);

  const qb = repo.createQueryBuilder('f')
    .innerJoinAndSelect('f.project', 'p')
    .leftJoinAndSelect('f.organism', 'o')
    .leftJoinAndSelect('f.experiment', 'e')
    .orderBy('f.uploadedAt', 'DESC');

  if (projectId) qb.andWhere('f.project_id = :projectId', { projectId });
  if (organismId) qb.andWhere('f.organism_id = :organismId', { organismId });
  if (experimentId) qb.andWhere('f.experiment_id = :experimentId', { experimentId });

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
    organismId:  f.organismId,
    organismDisplay: f.organism
      ? `${f.organism.genus.charAt(0)}. ${f.organism.species}${f.organism.strain ? ' ' + f.organism.strain : ''}`
      : null,
    experimentId:   f.experimentId,
    experimentName: f.experiment?.name ?? null,
    uploadedBy:     f.uploadedBy,
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
  const { filename, projectId, contentType, sizeBytes, description, tags, organismId, experimentId } =
    req.body as {
      filename:    string;
      projectId:   string;
      contentType: string;
      sizeBytes:   number;
      description?: string;
      tags?: string[];
      organismId?: string;
      experimentId?: string;
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
    organismId: organismId ?? null,
    experimentId: experimentId ?? null,
    uploadedBy: (res.locals.user as User)?.email ?? null,
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
  await AppDataSource.synchronize();
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
