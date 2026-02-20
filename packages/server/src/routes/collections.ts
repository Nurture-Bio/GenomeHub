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
      ? qb.andWhere(':type = ANY(c.type)', { type })
      : qb.where(':type = ANY(c.type)', { type });
  }

  const collections = await qb.getMany();
  if (!collections.length) { res.json([]); return; }

  const colIds = collections.map(c => c.id);

  // Load all edges from these collections
  const allEdges = await edgeRepo.createQueryBuilder('e')
    .where('e.source_type = :st AND e.source_id IN (:...ids)', { st: 'collection', ids: colIds })
    .getMany();

  const techniqueIdsByCol = new Map<string, string[]>();
  const organismIdsByCol = new Map<string, string[]>();
  for (const e of allEdges) {
    if (e.relation === 'has_type') {
      const arr = techniqueIdsByCol.get(e.sourceId) ?? [];
      arr.push(e.targetId);
      techniqueIdsByCol.set(e.sourceId, arr);
    }
    if (e.relation === 'targets' && e.targetType === 'organism') {
      const arr = organismIdsByCol.get(e.sourceId) ?? [];
      arr.push(e.targetId);
      organismIdsByCol.set(e.sourceId, arr);
    }
  }

  // Load related entities
  const allTypeIds = [...new Set([...techniqueIdsByCol.values()].flat())];
  const allOrgIds = [...new Set([...organismIdsByCol.values()].flat())];

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
    const tIds = techniqueIdsByCol.get(c.id) ?? [];
    const oIds = organismIdsByCol.get(c.id) ?? [];

    return {
      id: c.id,
      name: c.name,
      description: c.description,
      types: c.type,
      metadata: c.metadata,
      techniques: tIds.map(tId => {
        const tech = typeMap.get(tId);
        return { id: tId, name: tech?.name ?? tId };
      }),
      organisms: oIds.map(oId => {
        const org = orgMap.get(oId);
        return { id: oId, displayName: org ? organismDisplay(org) : oId };
      }),
      createdBy: c.createdBy,
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

  const techniqueIds: string[] = [];
  const orgIds: string[] = [];
  for (const e of colEdges) {
    if (e.relation === 'has_type') techniqueIds.push(e.targetId);
    if (e.relation === 'targets' && e.targetType === 'organism') orgIds.push(e.targetId);
  }

  const techniques = techniqueIds.length
    ? await AppDataSource.getRepository(Technique).findByIds(techniqueIds)
    : [];
  const techMap = new Map(techniques.map(t => [t.id, t]));

  const uniqueOrgIds = [...new Set(orgIds)];
  const organisms = uniqueOrgIds.length
    ? await AppDataSource.getRepository(Organism).findByIds(uniqueOrgIds)
    : [];
  const orgMap = new Map(organisms.map(o => [o.id, o]));

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
    types: col.type,
    metadata: col.metadata,
    techniques: techniqueIds.map(tId => {
      const tech = techMap.get(tId);
      return tech ? { id: tech.id, name: tech.name } : { id: tId, name: tId };
    }),
    organisms: orgIds.map(oId => {
      const org = orgMap.get(oId);
      return { id: oId, displayName: org ? organismDisplay(org) : oId };
    }),
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
      types: f.type,
      format: f.format,
      sizeBytes: Number(f.sizeBytes),
      status: f.status,
      uploadedAt: f.uploadedAt,
    })),
  });
}));

// ─── Create collection ──────────────────────────────────────

router.post('/', asyncWrap(async (req, res) => {
  const { name, types, metadata, description, techniqueIds, organismIds } = req.body as {
    name: string;
    types?: string[];
    metadata?: Record<string, unknown>;
    description?: string;
    techniqueIds?: string[];
    organismIds?: string[];
  };
  if (!name) {
    res.status(400).json({ error: 'name required' }); return;
  }

  const repo = AppDataSource.getRepository(Collection);
  const col = repo.create({
    name,
    description: description ?? null,
    type: types ?? ['experiment'],
    metadata: metadata ?? null,
    createdBy: (res.locals.user as User)?.email ?? null,
  });
  await repo.save(col);

  const userId = (res.locals.user as User)?.id ?? null;

  if (organismIds?.length) {
    for (const orgId of organismIds) {
      await edges.link({ type: 'collection', id: col.id }, { type: 'organism', id: orgId }, 'targets', null, userId);
    }
  }
  if (techniqueIds?.length) {
    for (const techId of techniqueIds) {
      await edges.link({ type: 'collection', id: col.id }, { type: 'technique', id: techId }, 'has_type', null, userId);
    }
  }

  res.status(201).json(col);
}));

// ─── Update collection ──────────────────────────────────────

router.put('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Collection);
  const col = await repo.findOneBy({ id: req.params.id });
  if (!col) { res.status(404).json({ error: 'not found' }); return; }

  const { name, types, metadata, description } = req.body as Partial<{
    name: string; types: string[]; metadata: Record<string, unknown>;
    description: string;
  }>;

  if (name !== undefined) col.name = name;
  if (description !== undefined) col.description = description || null;
  if (types !== undefined) col.type = types;
  if (metadata !== undefined) col.metadata = metadata;

  await repo.save(col);

  res.json(col);
}));

// ─── Collection organism link/unlink ─────────────────────────

router.post('/:id/organisms', asyncWrap(async (req, res) => {
  const col = await AppDataSource.getRepository(Collection).findOneBy({ id: req.params.id });
  if (!col) { res.status(404).json({ error: 'collection not found' }); return; }

  const { organismId } = req.body as { organismId: string };
  if (!organismId) { res.status(400).json({ error: 'organismId required' }); return; }

  const organism = await AppDataSource.getRepository(Organism).findOneBy({ id: organismId });
  if (!organism) { res.status(400).json({ error: 'organism not found' }); return; }

  const userId = (res.locals.user as User)?.id ?? null;
  await edges.link({ type: 'collection', id: col.id }, { type: 'organism', id: organismId }, 'targets', null, userId);
  res.status(201).json({ ok: true });
}));

router.delete('/:id/organisms/:organismId', asyncWrap(async (req, res) => {
  await edges.unlink(
    { type: 'collection', id: req.params.id },
    { type: 'organism', id: req.params.organismId },
    'targets',
  );
  res.json({ ok: true });
}));

// ─── Collection technique link/unlink ────────────────────────

router.post('/:id/techniques', asyncWrap(async (req, res) => {
  const col = await AppDataSource.getRepository(Collection).findOneBy({ id: req.params.id });
  if (!col) { res.status(404).json({ error: 'collection not found' }); return; }

  const { techniqueId } = req.body as { techniqueId: string };
  if (!techniqueId) { res.status(400).json({ error: 'techniqueId required' }); return; }

  const technique = await AppDataSource.getRepository(Technique).findOneBy({ id: techniqueId });
  if (!technique) { res.status(400).json({ error: 'technique not found' }); return; }

  const userId = (res.locals.user as User)?.id ?? null;
  await edges.link({ type: 'collection', id: col.id }, { type: 'technique', id: techniqueId }, 'has_type', null, userId);
  res.status(201).json({ ok: true });
}));

router.delete('/:id/techniques/:techniqueId', asyncWrap(async (req, res) => {
  await edges.unlink(
    { type: 'collection', id: req.params.id },
    { type: 'technique', id: req.params.techniqueId },
    'has_type',
  );
  res.json({ ok: true });
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
