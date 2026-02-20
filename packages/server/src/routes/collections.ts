import { Router } from 'express';
import { AppDataSource } from '../app_data.js';
import { User, Collection, GenomicFile, Organism, Technique, EntityEdge } from '../entities/index.js';
import * as edges from '../lib/edge_service.js';
import { asyncWrap } from '../lib/async_wrap.js';
import { organismDisplay } from '../lib/display.js';

const router = Router();

// ─── List collections ───────────────────────────────────────

router.get('/', asyncWrap(async (req, res) => {
  const { organismId, type } = req.query as {
    organismId?: string; type?: string;
  };

  const edgeRepo = AppDataSource.getRepository(EntityEdge);
  let filteredIds: string[] | null = null;

  if (organismId) {
    const orgEdges = await edgeRepo.find({
      where: { sourceType: 'collection' as any, targetType: 'organism' as any, targetId: organismId, relation: 'targets' as any },
    });
    filteredIds = orgEdges.map(e => e.sourceId);
  }

  const repo = AppDataSource.getRepository(Collection);
  let qb = repo.createQueryBuilder('c').orderBy('c.created_at', 'DESC');

  if (filteredIds !== null) {
    if (!filteredIds.length) { res.json([]); return; }
    qb = qb.where('c.id IN (:...ids)', { ids: filteredIds });
  }

  if (type) {
    qb = filteredIds !== null
      ? qb.andWhere('c.type = :type', { type })
      : qb.where('c.type = :type', { type });
  }

  const collections = await qb.getMany();
  if (!collections.length) { res.json([]); return; }

  const colIds = collections.map(c => c.id);

  // Load all edges from these collections
  const allEdges = await edgeRepo.createQueryBuilder('e')
    .where('e.source_type = :st AND e.source_id IN (:...ids)', { st: 'collection', ids: colIds })
    .getMany();

  const typeIdByCol = new Map<string, string>();
  const orgIdByCol = new Map<string, string>();
  for (const e of allEdges) {
    if (e.relation === 'has_type') typeIdByCol.set(e.sourceId, e.targetId);
    if (e.relation === 'targets' && e.targetType === 'organism') orgIdByCol.set(e.sourceId, e.targetId);
  }

  // Load related entities
  const allTypeIds = [...new Set(typeIdByCol.values())];
  const allOrgIds = [...new Set(orgIdByCol.values())];

  const typeMap = new Map<string, Technique>();
  const orgMap = new Map<string, Organism>();

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
    const tId = typeIdByCol.get(c.id);
    const oId = orgIdByCol.get(c.id);
    const tech = tId ? typeMap.get(tId) : null;
    const org = oId ? orgMap.get(oId) : null;

    return {
      id: c.id,
      name: c.name,
      description: c.description,
      type: c.type,
      metadata: c.metadata,
      techniqueId: tId ?? null,
      techniqueName: tech?.name ?? null,
      createdBy: c.createdBy,
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

  let typeId: string | null = null;
  let orgId: string | null = null;
  for (const e of colEdges) {
    if (e.relation === 'has_type') typeId = e.targetId;
    if (e.relation === 'targets' && e.targetType === 'organism') orgId = e.targetId;
  }

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
    type: col.type,
    metadata: col.metadata,
    technique: technique ? { id: technique.id, name: technique.name } : null,
    organismId: orgId,
    organismDisplay: organism ? organismDisplay(organism) : null,
    createdBy: col.createdBy,
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
      type: f.type,
      format: f.format,
      sizeBytes: Number(f.sizeBytes),
      status: f.status,
      uploadedAt: f.uploadedAt,
    })),
  });
}));

// ─── Create collection ──────────────────────────────────────

router.post('/', asyncWrap(async (req, res) => {
  const { name, type, metadata, description, techniqueId, organismId } = req.body as {
    name: string;
    type?: string;
    metadata?: Record<string, unknown>;
    description?: string;
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
    type: type ?? 'experiment',
    metadata: metadata ?? null,
    createdBy: (res.locals.user as User)?.email ?? null,
  });
  await repo.save(col);

  const userId = (res.locals.user as User)?.id ?? null;

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

  const { name, type, metadata, description, techniqueId, organismId } = req.body as Partial<{
    name: string; type: string; metadata: Record<string, unknown>;
    description: string; techniqueId: string; organismId: string;
  }>;

  if (name !== undefined) col.name = name;
  if (description !== undefined) col.description = description || null;
  if (type !== undefined) col.type = type;
  if (metadata !== undefined) col.metadata = metadata;

  await repo.save(col);

  const userId = (res.locals.user as User)?.id ?? null;

  if (organismId !== undefined) {
    await edges.replaceEdge({ type: 'collection', id: col.id }, 'targets', 'organism', organismId || null, userId);
  }

  if (techniqueId !== undefined) {
    await edges.replaceEdge({ type: 'collection', id: col.id }, 'has_type', 'technique', techniqueId || null, userId);
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

  // Check for files in this collection
  const fileCount = await edges.countReferences({ type: 'collection', id: col.id });
  if (fileCount > 0) {
    res.status(409).json({ error: `Cannot delete: collection still has ${fileCount} reference(s). Remove all files first.` });
    return;
  }
  await repo.remove(col);
  res.json({ ok: true });
}));

export default router;
