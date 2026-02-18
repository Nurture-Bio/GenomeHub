/**
 * GenomeHub server.
 *
 * Express API that:
 *  - Serves the Vite-built client from /dist/client
 *  - Exposes REST endpoints for projects, experiments, samples, files, links
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
import {
  User, Project, Organism, ExperimentType, Experiment,
  Sample, ExternalLink, GenomicFile,
} from './entities/index.js';
import {
  buildS3Key, initiateMultipartUpload, presignPartUrl,
  completeMultipartUpload, abortMultipartUpload,
  deleteObject, presignDownloadUrl, headObject,
} from './lib/s3.js';
import { detectLinkService } from './lib/link_service.js';

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

// ─── Project tree ─────────────────────────────────────────

app.get('/api/projects/:id/tree', asyncWrap(async (req, res) => {
  const projectId = req.params.id;
  const projRepo = AppDataSource.getRepository(Project);
  const project = await projRepo.findOneBy({ id: projectId });
  if (!project) { res.status(404).json({ error: 'not found' }); return; }

  // Experiments with type
  const experiments = await AppDataSource.getRepository(Experiment)
    .find({
      where: { projectId },
      relations: ['experimentType'],
      order: { createdAt: 'DESC' },
    });

  // Samples keyed by experimentId
  const samples = await AppDataSource.getRepository(Sample)
    .createQueryBuilder('s')
    .where('s.experiment_id IN (:...expIds)', {
      expIds: experiments.length ? experiments.map(e => e.id) : ['00000000-0000-0000-0000-000000000000'],
    })
    .orderBy('s.created_at', 'ASC')
    .getMany();
  const samplesByExp = new Map<string, typeof samples>();
  for (const s of samples) {
    const list = samplesByExp.get(s.experimentId) ?? [];
    list.push(s);
    samplesByExp.set(s.experimentId, list);
  }

  // File counts keyed by sampleId + experimentId + project-level
  const fileCounts = await AppDataSource.getRepository(GenomicFile)
    .createQueryBuilder('f')
    .select('f.project_id', 'projectId')
    .addSelect('f.experiment_id', 'experimentId')
    .addSelect('f.sample_id', 'sampleId')
    .addSelect('COUNT(*)', 'count')
    .where('f.project_id = :projectId', { projectId })
    .groupBy('f.project_id')
    .addGroupBy('f.experiment_id')
    .addGroupBy('f.sample_id')
    .getRawMany<{ projectId: string; experimentId: string | null; sampleId: string | null; count: string }>();

  // Build count maps
  let projectFileCount = 0;
  const expFileCounts = new Map<string, number>();
  const sampleFileCounts = new Map<string, number>();
  for (const r of fileCounts) {
    const c = parseInt(r.count);
    projectFileCount += c;
    if (r.experimentId) expFileCounts.set(r.experimentId, (expFileCounts.get(r.experimentId) ?? 0) + c);
    if (r.sampleId) sampleFileCounts.set(r.sampleId, (sampleFileCounts.get(r.sampleId) ?? 0) + c);
  }

  // Links
  const allLinks = await AppDataSource.getRepository(ExternalLink)
    .createQueryBuilder('l')
    .where(
      '(l.parent_type = :pt AND l.parent_id = :projectId) OR ' +
      '(l.parent_type = :et AND l.parent_id IN (:...allIds))',
      {
        pt: 'project', et: 'experiment', projectId,
        allIds: [
          ...experiments.map(e => e.id),
          ...samples.map(s => s.id),
          '00000000-0000-0000-0000-000000000000',
        ],
      }
    )
    .orWhere('l.parent_type = :st AND l.parent_id IN (:...sampleIds)', {
      st: 'sample',
      sampleIds: samples.length ? samples.map(s => s.id) : ['00000000-0000-0000-0000-000000000000'],
    })
    .orderBy('l.created_at', 'ASC')
    .getMany();

  const linksByParent = new Map<string, ExternalLink[]>();
  for (const l of allLinks) {
    const key = `${l.parentType}:${l.parentId}`;
    const list = linksByParent.get(key) ?? [];
    list.push(l);
    linksByParent.set(key, list);
  }

  res.json({
    ...project,
    fileCount: projectFileCount,
    links: linksByParent.get(`project:${projectId}`) ?? [],
    experiments: experiments.map(e => ({
      id: e.id,
      name: e.name,
      description: e.description,
      experimentType: e.experimentType ? { id: e.experimentType.id, name: e.experimentType.name } : null,
      technique: e.technique,
      organism: e.organism,
      referenceGenome: e.referenceGenome,
      status: e.status,
      fileCount: expFileCounts.get(e.id) ?? 0,
      links: linksByParent.get(`experiment:${e.id}`) ?? [],
      samples: (samplesByExp.get(e.id) ?? []).map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        condition: s.condition,
        replicate: s.replicate,
        metadata: s.metadata,
        fileCount: sampleFileCounts.get(s.id) ?? 0,
        links: linksByParent.get(`sample:${s.id}`) ?? [],
      })),
    })),
  });
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

// ─── Experiment Types ────────────────────────────────────

app.get('/api/experiment-types', asyncWrap(async (_req, res) => {
  const repo = AppDataSource.getRepository(ExperimentType);
  const types = await repo.find({ order: { name: 'ASC' } });
  res.json(types);
}));

app.post('/api/experiment-types', asyncWrap(async (req, res) => {
  const { name, description, defaultTags } = req.body as {
    name: string; description?: string; defaultTags?: string[];
  };
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  const repo = AppDataSource.getRepository(ExperimentType);
  const et = repo.create({
    name,
    description: description ?? null,
    defaultTags: defaultTags ?? [],
  });
  await repo.save(et);
  res.status(201).json(et);
}));

app.put('/api/experiment-types/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(ExperimentType);
  const et = await repo.findOneBy({ id: req.params.id });
  if (!et) { res.status(404).json({ error: 'not found' }); return; }

  const { name, description, defaultTags } = req.body as {
    name?: string; description?: string; defaultTags?: string[];
  };
  if (name !== undefined) et.name = name;
  if (description !== undefined) et.description = description;
  if (defaultTags !== undefined) et.defaultTags = defaultTags;
  await repo.save(et);
  res.json(et);
}));

app.delete('/api/experiment-types/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(ExperimentType);
  const et = await repo.findOneBy({ id: req.params.id });
  if (!et) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(et);
  res.json({ ok: true });
}));

// ─── Experiments ──────────────────────────────────────────

app.get('/api/experiments', asyncWrap(async (req, res) => {
  const { projectId, organismId } = req.query as { projectId?: string; organismId?: string };
  const repo = AppDataSource.getRepository(Experiment);

  const qb = repo.createQueryBuilder('e')
    .leftJoinAndSelect('e.project', 'p')
    .leftJoinAndSelect('e.experimentType', 'et')
    .leftJoinAndSelect('e.organismEntity', 'o')
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

  // Sample counts
  const sampleCounts = await AppDataSource.getRepository(Sample)
    .createQueryBuilder('s')
    .select('s.experiment_id', 'experimentId')
    .addSelect('COUNT(*)', 'sampleCount')
    .groupBy('s.experiment_id')
    .getRawMany<{ experimentId: string; sampleCount: string }>();
  const sampleMap = new Map(sampleCounts.map(s => [s.experimentId, parseInt(s.sampleCount)]));

  res.json(experiments.map(e => ({
    id: e.id,
    name: e.name,
    description: e.description,
    technique: e.technique,
    experimentTypeId: e.experimentTypeId,
    experimentTypeName: e.experimentType?.name ?? null,
    organism: e.organism,
    referenceGenome: e.referenceGenome,
    metadata: e.metadata,
    status: e.status,
    experimentDate: e.experimentDate,
    createdBy: e.createdBy,
    projectId: e.projectId,
    projectName: e.project?.name ?? null,
    organismId: e.organismId,
    organismDisplay: e.organismEntity
      ? `${e.organismEntity.genus.charAt(0)}. ${e.organismEntity.species}${e.organismEntity.strain ? ' ' + e.organismEntity.strain : ''}`
      : null,
    fileCount: fileMap.get(e.id) ?? 0,
    sampleCount: sampleMap.get(e.id) ?? 0,
    createdAt: e.createdAt,
  })));
}));

app.post('/api/experiments', asyncWrap(async (req, res) => {
  const {
    name, projectId, experimentTypeId, technique,
    description, organism, referenceGenome, metadata,
    experimentDate, organismId, status,
  } = req.body as {
    name: string; projectId: string; experimentTypeId?: string; technique?: string;
    description?: string; organism?: string; referenceGenome?: string;
    metadata?: Record<string, unknown>; experimentDate?: string;
    organismId?: string; status?: string;
  };
  if (!name || !projectId) {
    res.status(400).json({ error: 'name and projectId required' }); return;
  }

  const repo = AppDataSource.getRepository(Experiment);
  const exp = repo.create({
    name, projectId,
    experimentTypeId: experimentTypeId ?? null,
    technique: technique ?? null,
    description: description ?? null,
    organism: organism ?? null,
    referenceGenome: referenceGenome ?? null,
    metadata: metadata ?? null,
    status: (status as 'active' | 'complete' | 'archived') ?? 'active',
    experimentDate: experimentDate ?? null,
    createdBy: (res.locals.user as User)?.email ?? null,
    organismId: organismId ?? null,
  });
  await repo.save(exp);
  res.status(201).json(exp);
}));

app.put('/api/experiments/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Experiment);
  const exp = await repo.findOneBy({ id: req.params.id });
  if (!exp) { res.status(404).json({ error: 'not found' }); return; }

  const {
    name, experimentTypeId, technique, description,
    organism, referenceGenome, metadata, status,
    experimentDate, organismId,
  } = req.body as Partial<{
    name: string; experimentTypeId: string; technique: string;
    description: string; organism: string; referenceGenome: string;
    metadata: Record<string, unknown>; status: string;
    experimentDate: string; organismId: string;
  }>;

  if (name !== undefined) exp.name = name;
  if (experimentTypeId !== undefined) exp.experimentTypeId = experimentTypeId || null;
  if (technique !== undefined) exp.technique = technique || null;
  if (description !== undefined) exp.description = description || null;
  if (organism !== undefined) exp.organism = organism || null;
  if (referenceGenome !== undefined) exp.referenceGenome = referenceGenome || null;
  if (metadata !== undefined) exp.metadata = metadata;
  if (status !== undefined) exp.status = status as 'active' | 'complete' | 'archived';
  if (experimentDate !== undefined) exp.experimentDate = experimentDate || null;
  if (organismId !== undefined) exp.organismId = organismId || null;

  await repo.save(exp);
  res.json(exp);
}));

app.delete('/api/experiments/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Experiment);
  const exp = await repo.findOneBy({ id: req.params.id });
  if (!exp) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(exp);
  res.json({ ok: true });
}));

// ─── Samples ──────────────────────────────────────────────

app.get('/api/samples', asyncWrap(async (req, res) => {
  const { experimentId } = req.query as { experimentId?: string };
  const repo = AppDataSource.getRepository(Sample);

  const qb = repo.createQueryBuilder('s')
    .leftJoinAndSelect('s.experiment', 'e')
    .orderBy('s.created_at', 'ASC');

  if (experimentId) qb.andWhere('s.experiment_id = :experimentId', { experimentId });

  const samples = await qb.getMany();

  // File counts
  const fileCounts = await AppDataSource.getRepository(GenomicFile)
    .createQueryBuilder('f')
    .select('f.sample_id', 'sampleId')
    .addSelect('COUNT(*)', 'fileCount')
    .where('f.sample_id IS NOT NULL')
    .groupBy('f.sample_id')
    .getRawMany<{ sampleId: string; fileCount: string }>();
  const fileMap = new Map(fileCounts.map(s => [s.sampleId, parseInt(s.fileCount)]));

  res.json(samples.map(s => ({
    id: s.id,
    experimentId: s.experimentId,
    experimentName: s.experiment?.name ?? null,
    name: s.name,
    description: s.description,
    condition: s.condition,
    replicate: s.replicate,
    metadata: s.metadata,
    fileCount: fileMap.get(s.id) ?? 0,
    createdAt: s.createdAt,
  })));
}));

app.post('/api/samples', asyncWrap(async (req, res) => {
  const { experimentId, name, description, condition, replicate, metadata } = req.body as {
    experimentId: string; name: string; description?: string;
    condition?: string; replicate?: number; metadata?: Record<string, unknown>;
  };
  if (!experimentId || !name) {
    res.status(400).json({ error: 'experimentId and name required' }); return;
  }

  const repo = AppDataSource.getRepository(Sample);
  const sample = repo.create({
    experimentId, name,
    description: description ?? null,
    condition: condition ?? null,
    replicate: replicate ?? null,
    metadata: metadata ?? null,
  });
  await repo.save(sample);
  res.status(201).json(sample);
}));

app.put('/api/samples/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Sample);
  const sample = await repo.findOneBy({ id: req.params.id });
  if (!sample) { res.status(404).json({ error: 'not found' }); return; }

  const { name, description, condition, replicate, metadata } = req.body as Partial<{
    name: string; description: string; condition: string;
    replicate: number; metadata: Record<string, unknown>;
  }>;

  if (name !== undefined) sample.name = name;
  if (description !== undefined) sample.description = description || null;
  if (condition !== undefined) sample.condition = condition || null;
  if (replicate !== undefined) sample.replicate = replicate;
  if (metadata !== undefined) sample.metadata = metadata;

  await repo.save(sample);
  res.json(sample);
}));

app.delete('/api/samples/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Sample);
  const sample = await repo.findOneBy({ id: req.params.id });
  if (!sample) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(sample);
  res.json({ ok: true });
}));

// ─── External Links ───────────────────────────────────────

app.get('/api/links', asyncWrap(async (req, res) => {
  const { parentType, parentId } = req.query as { parentType?: string; parentId?: string };
  const repo = AppDataSource.getRepository(ExternalLink);

  const qb = repo.createQueryBuilder('l').orderBy('l.created_at', 'ASC');
  if (parentType) qb.andWhere('l.parent_type = :parentType', { parentType });
  if (parentId) qb.andWhere('l.parent_id = :parentId', { parentId });

  res.json(await qb.getMany());
}));

app.post('/api/links', asyncWrap(async (req, res) => {
  const { parentType, parentId, url, label } = req.body as {
    parentType: string; parentId: string; url: string; label?: string;
  };
  if (!parentType || !parentId || !url) {
    res.status(400).json({ error: 'parentType, parentId, and url required' }); return;
  }

  const detected = detectLinkService(url);
  const repo = AppDataSource.getRepository(ExternalLink);
  const link = repo.create({
    parentType: parentType as 'project' | 'experiment' | 'sample',
    parentId,
    url,
    service: detected.service,
    label: label ?? detected.label ?? null,
  });
  await repo.save(link);
  res.status(201).json(link);
}));

app.put('/api/links/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(ExternalLink);
  const link = await repo.findOneBy({ id: req.params.id });
  if (!link) { res.status(404).json({ error: 'not found' }); return; }

  const { url, label } = req.body as { url?: string; label?: string };
  if (url !== undefined) {
    link.url = url;
    const detected = detectLinkService(url);
    link.service = detected.service;
    if (label === undefined) link.label = detected.label ?? link.label;
  }
  if (label !== undefined) link.label = label || null;

  await repo.save(link);
  res.json(link);
}));

app.delete('/api/links/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(ExternalLink);
  const link = await repo.findOneBy({ id: req.params.id });
  if (!link) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(link);
  res.json({ ok: true });
}));

// ─── Files ─────────────────────────────────────────────────

app.get('/api/files', asyncWrap(async (req, res) => {
  const { projectId, organismId, experimentId, sampleId } = req.query as {
    projectId?: string; organismId?: string; experimentId?: string; sampleId?: string;
  };
  const repo = AppDataSource.getRepository(GenomicFile);

  const qb = repo.createQueryBuilder('f')
    .innerJoinAndSelect('f.project', 'p')
    .leftJoinAndSelect('f.organism', 'o')
    .leftJoinAndSelect('f.experiment', 'e')
    .leftJoinAndSelect('f.sample', 's')
    .orderBy('f.uploadedAt', 'DESC');

  if (projectId) qb.andWhere('f.project_id = :projectId', { projectId });
  if (organismId) qb.andWhere('f.organism_id = :organismId', { organismId });
  if (experimentId) qb.andWhere('f.experiment_id = :experimentId', { experimentId });
  if (sampleId) qb.andWhere('f.sample_id = :sampleId', { sampleId });

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
    sampleId:       f.sampleId,
    sampleName:     f.sample?.name ?? null,
    uploadedBy:     f.uploadedBy,
  })));
}));

app.put('/api/files/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(GenomicFile);
  const file = await repo.findOneBy({ id: req.params.id });
  if (!file) { res.status(404).json({ error: 'not found' }); return; }

  const { sampleId, experimentId, organismId, description, tags } = req.body as Partial<{
    sampleId: string | null; experimentId: string | null; organismId: string | null;
    description: string | null; tags: string[];
  }>;

  if (sampleId !== undefined) file.sampleId = sampleId;
  if (experimentId !== undefined) file.experimentId = experimentId;
  if (organismId !== undefined) file.organismId = organismId;
  if (description !== undefined) file.description = description;
  if (tags !== undefined) file.tags = tags;

  await repo.save(file);
  res.json(file);
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
  const { filename, projectId, contentType, sizeBytes, description, tags, organismId, experimentId, sampleId } =
    req.body as {
      filename:    string;
      projectId:   string;
      contentType: string;
      sizeBytes:   number;
      description?: string;
      tags?: string[];
      organismId?: string;
      experimentId?: string;
      sampleId?: string;
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
    sampleId: sampleId ?? null,
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
