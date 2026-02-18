import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { User, Collection, GenomicFile, Organism, Technique, EntityEdge } from '../entities/index.js';
import * as edges from '../lib/edge_service.js';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

function organismDisplay(o: Organism): string {
  return `${o.genus.charAt(0)}. ${o.species}${o.strain ? ' ' + o.strain : ''}`;
}

// ─── List collections ───────────────────────────────────────

router.get('/', asyncWrap(async (req, res) => {
  const { projectId, organismId, kind } = req.query as {
    projectId?: string; organismId?: string; kind?: string;
  };

  const edgeRepo = AppDataSource.getRepository(EntityEdge);
  let filteredIds: string[] | null = null;

  if (projectId) {
    const projEdges = await edgeRepo.find({
      where: { sourceType: 'collection' as any, targetType: 'project' as any, targetId: projectId, relation: 'belongs_to' as any },
    });
    filteredIds = projEdges.map(e => e.sourceId);
  }

  if (organismId) {
    const orgEdges = await edgeRepo.find({
      where: { sourceType: 'collection' as any, targetType: 'organism' as any, targetId: organismId, relation: 'targets' as any },
    });
    const orgIds = orgEdges.map(e => e.sourceId);
    filteredIds = filteredIds ? filteredIds.filter(id => orgIds.includes(id)) : orgIds;
  }

  const repo = AppDataSource.getRepository(Collection);
  let qb = repo.createQueryBuilder('c').orderBy('c.created_at', 'DESC');

  if (filteredIds !== null) {
    if (!filteredIds.length) { res.json([]); return; }
    qb = qb.where('c.id IN (:...ids)', { ids: filteredIds });
  }

  if (kind) {
    qb = filteredIds !== null
      ? qb.andWhere('c.kind = :kind', { kind })
      : qb.where('c.kind = :kind', { kind });
  }

  const collections = await qb.getMany();
  if (!collections.length) { res.json([]); return; }

  const colIds = collections.map(c => c.id);

  // Load all edges from these collections
  const allEdges = await edgeRepo.createQueryBuilder('e')
    .where('e.source_type = :st AND e.source_id IN (:...ids)', { st: 'collection', ids: colIds })
    .getMany();

  const projectIdByCol = new Map<string, string>();
  const typeIdByCol = new Map<string, string>();
  const orgIdByCol = new Map<string, string>();
  for (const e of allEdges) {
    if (e.relation === 'belongs_to' && e.targetType === 'project') projectIdByCol.set(e.sourceId, e.targetId);
    if (e.relation === 'has_type') typeIdByCol.set(e.sourceId, e.targetId);
    if (e.relation === 'targets' && e.targetType === 'organism') orgIdByCol.set(e.sourceId, e.targetId);
  }

  // Load related entities
  const { Project } = await import('../entities/index.js');
  const allProjectIds = [...new Set(projectIdByCol.values())];
  const allTypeIds = [...new Set(typeIdByCol.values())];
  const allOrgIds = [...new Set(orgIdByCol.values())];

  const projectMap = new Map<string, { id: string; name: string }>();
  const typeMap = new Map<string, Technique>();
  const orgMap = new Map<string, Organism>();

  if (allProjectIds.length) {
    const projects = await AppDataSource.getRepository(Project).findByIds(allProjectIds);
    projects.forEach(p => projectMap.set(p.id, p));
  }
  if (allTypeIds.length) {
    const types = await AppDataSource.getRepository(Technique).findByIds(allTypeIds);
    types.forEach(t => typeMap.set(t.id, t));
  }
  if (allOrgIds.length) {
    const orgs = await AppDataSource.getRepository(Organism).findByIds(allOrgIds);
    orgs.forEach(o => orgMap.set(o.id, o));
  }

  // File counts
  const fileCounts = await edgeRepo
    .createQueryBuilder('e')
    .select('e.target_id', 'targetId')
    .addSelect('COUNT(*)', 'fileCount')
    .where("e.source_type = 'file' AND e.target_type = 'collection' AND e.relation = 'belongs_to'")
    .andWhere('e.target_id IN (:...ids)', { ids: colIds })
    .groupBy('e.target_id')
    .getRawMany<{ targetId: string; fileCount: string }>();
  const fileMap = new Map(fileCounts.map(s => [s.targetId, parseInt(s.fileCount)]));

  res.json(collections.map(c => {
    const pId = projectIdByCol.get(c.id);
    const tId = typeIdByCol.get(c.id);
    const oId = orgIdByCol.get(c.id);
    const prj = pId ? projectMap.get(pId) : null;
    const tech = tId ? typeMap.get(tId) : null;
    const org = oId ? orgMap.get(oId) : null;

    return {
      id: c.id,
      name: c.name,
      description: c.description,
      kind: c.kind,
      metadata: c.metadata,
      techniqueId: tId ?? null,
      techniqueName: tech?.name ?? null,
      createdBy: c.createdBy,
      projectId: pId ?? null,
      projectName: prj?.name ?? null,
      organismId: oId ?? null,
      organismDisplay: org ? organismDisplay(org) : null,
      fileCount: fileMap.get(c.id) ?? 0,
      createdAt: c.createdAt,
    };
  }));
}));

// ─── Get collection detail ──────────────────────────────────

router.get('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Collection);
  const col = await repo.findOneBy({ id: req.params.id });
  if (!col) { res.status(404).json({ error: 'not found' }); return; }

  const edgeRepo = AppDataSource.getRepository(EntityEdge);

  const colEdges = await edgeRepo.find({
    where: { sourceType: 'collection' as any, sourceId: col.id },
  });

  let projectId: string | null = null;
  let typeId: string | null = null;
  let orgId: string | null = null;
  for (const e of colEdges) {
    if (e.relation === 'belongs_to' && e.targetType === 'project') projectId = e.targetId;
    if (e.relation === 'has_type') typeId = e.targetId;
    if (e.relation === 'targets' && e.targetType === 'organism') orgId = e.targetId;
  }

  const { Project } = await import('../entities/index.js');
  const project = projectId ? await AppDataSource.getRepository(Project).findOneBy({ id: projectId }) : null;
  const technique = typeId ? await AppDataSource.getRepository(Technique).findOneBy({ id: typeId }) : null;
  const organism = orgId ? await AppDataSource.getRepository(Organism).findOneBy({ id: orgId }) : null;

  // Files belonging to this collection (playlist contents)
  const fileEdges = await edgeRepo.find({
    where: { sourceType: 'file' as any, targetType: 'collection' as any, targetId: col.id, relation: 'belongs_to' as any },
  });
  const fileIds = fileEdges.map(e => e.sourceId);
  const files = fileIds.length
    ? await AppDataSource.getRepository(GenomicFile).findByIds(fileIds)
    : [];

  // External links
  const linkEdges = await edgeRepo.createQueryBuilder('e')
    .where("e.relation = 'links_to'")
    .andWhere('e.source_id = :id', { id: col.id })
    .orderBy('e.created_at', 'ASC')
    .getMany();

  res.json({
    id: col.id,
    name: col.name,
    description: col.description,
    kind: col.kind,
    metadata: col.metadata,
    technique: technique ? { id: technique.id, name: technique.name } : null,
    organismId: orgId,
    organismDisplay: organism ? organismDisplay(organism) : null,
    createdBy: col.createdBy,
    projectId,
    projectName: project?.name ?? null,
    fileCount: files.length,
    links: linkEdges.map(e => ({
      id: e.id,
      url: (e.metadata as any)?.url ?? '',
      service: (e.metadata as any)?.service ?? 'link',
      label: (e.metadata as any)?.label ?? null,
      createdAt: e.createdAt,
    })),
    files: files.map(f => ({
      id: f.id,
      filename: f.filename,
      kind: f.kind,
      format: f.format,
      sizeBytes: Number(f.sizeBytes),
      status: f.status,
      uploadedAt: f.uploadedAt,
    })),
  });
}));

// ─── Create collection ──────────────────────────────────────

router.post('/', asyncWrap(async (req, res) => {
  const { name, kind, metadata, description, projectId, techniqueId, organismId } = req.body as {
    name: string;
    kind?: string;
    metadata?: Record<string, unknown>;
    description?: string;
    projectId?: string;
    techniqueId?: string;
    organismId?: string;
  };
  if (!name) {
    res.status(400).json({ error: 'name required' }); return;
  }

  const repo = AppDataSource.getRepository(Collection);
  const col = repo.create({
    name,
    description: description ?? null,
    kind: kind ?? 'experiment',
    metadata: metadata ?? null,
    createdBy: (res.locals.user as User)?.email ?? null,
  });
  await repo.save(col);

  const userId = (res.locals.user as User)?.id ?? null;

  if (projectId) {
    await edges.link({ type: 'collection', id: col.id }, { type: 'project', id: projectId }, 'belongs_to', null, userId);
  }
  if (organismId) {
    await edges.link({ type: 'collection', id: col.id }, { type: 'organism', id: organismId }, 'targets', null, userId);
  }
  if (techniqueId) {
    await edges.link({ type: 'collection', id: col.id }, { type: 'technique', id: techniqueId }, 'has_type', null, userId);
  }

  res.status(201).json(col);
}));

// ─── Update collection ──────────────────────────────────────

router.put('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Collection);
  const col = await repo.findOneBy({ id: req.params.id });
  if (!col) { res.status(404).json({ error: 'not found' }); return; }

  const { name, kind, metadata, description, projectId, techniqueId, organismId } = req.body as Partial<{
    name: string; kind: string; metadata: Record<string, unknown>;
    description: string; projectId: string; techniqueId: string; organismId: string;
  }>;

  if (name !== undefined) col.name = name;
  if (description !== undefined) col.description = description || null;
  if (kind !== undefined) col.kind = kind;
  if (metadata !== undefined) col.metadata = metadata;

  await repo.save(col);

  const userId = (res.locals.user as User)?.id ?? null;
  const edgeRepo = AppDataSource.getRepository(EntityEdge);

  if (projectId !== undefined) {
    await edgeRepo.delete({ sourceType: 'collection' as any, sourceId: col.id, targetType: 'project' as any, relation: 'belongs_to' as any });
    if (projectId) {
      await edges.link({ type: 'collection', id: col.id }, { type: 'project', id: projectId }, 'belongs_to', null, userId);
    }
  }

  if (organismId !== undefined) {
    await edgeRepo.delete({ sourceType: 'collection' as any, sourceId: col.id, targetType: 'organism' as any, relation: 'targets' as any });
    if (organismId) {
      await edges.link({ type: 'collection', id: col.id }, { type: 'organism', id: organismId }, 'targets', null, userId);
    }
  }

  if (techniqueId !== undefined) {
    await edgeRepo.delete({ sourceType: 'collection' as any, sourceId: col.id, relation: 'has_type' as any });
    if (techniqueId) {
      await edges.link({ type: 'collection', id: col.id }, { type: 'technique', id: techniqueId }, 'has_type', null, userId);
    }
  }

  res.json(col);
}));

// ─── Batch add files to collection ──────────────────────────

router.post('/:id/files', asyncWrap(async (req, res) => {
  const col = await AppDataSource.getRepository(Collection).findOneBy({ id: req.params.id });
  if (!col) { res.status(404).json({ error: 'not found' }); return; }

  const { fileIds } = req.body as { fileIds: string[] };
  if (!fileIds?.length) { res.status(400).json({ error: 'fileIds required' }); return; }

  const userId = (res.locals.user as User)?.id ?? null;
  for (const fileId of fileIds) {
    await edges.link({ type: 'file', id: fileId }, { type: 'collection', id: col.id }, 'belongs_to', null, userId);
  }

  res.json({ ok: true, added: fileIds.length });
}));

// ─── Batch remove files from collection ─────────────────────

router.delete('/:id/files', asyncWrap(async (req, res) => {
  const col = await AppDataSource.getRepository(Collection).findOneBy({ id: req.params.id });
  if (!col) { res.status(404).json({ error: 'not found' }); return; }

  const { fileIds } = req.body as { fileIds: string[] };
  if (!fileIds?.length) { res.status(400).json({ error: 'fileIds required' }); return; }

  for (const fileId of fileIds) {
    await edges.unlink({ type: 'file', id: fileId }, { type: 'collection', id: col.id }, 'belongs_to');
  }

  res.json({ ok: true, removed: fileIds.length });
}));

// ─── Delete collection ──────────────────────────────────────

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Collection);
  const col = await repo.findOneBy({ id: req.params.id });
  if (!col) { res.status(404).json({ error: 'not found' }); return; }

  await edges.cascadeDelete({ type: 'collection', id: col.id });
  await repo.remove(col);
  res.json({ ok: true });
}));

export default router;
