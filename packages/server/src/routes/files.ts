import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { User, GenomicFile, EntityEdge, Organism, Collection, Project, type EdgeRelation } from '../entities/index.js';
import { deleteObject, presignDownloadUrl } from '../lib/s3.js';
import * as edges from '../lib/edge_service.js';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

function organismDisplay(o: Organism): string {
  return `${o.genus.charAt(0)}. ${o.species}${o.strain ? ' ' + o.strain : ''}`;
}

const PROVENANCE_RELATIONS = ['derived_from', 'sequenced_from', 'produced_by'];

// ─── List files ─────────────────────────────────────────────

router.get('/', asyncWrap(async (req, res) => {
  const { projectId, organismId, collectionId, kind } = req.query as {
    projectId?: string; organismId?: string; collectionId?: string; kind?: string;
  };

  const edgeRepo = AppDataSource.getRepository(EntityEdge);

  // Collect ID sets from each filter, then intersect
  const idSets: string[][] = [];

  async function addFilter(targetType: string, targetId: string, relation: string) {
    const found = await edgeRepo.find({
      where: { sourceType: 'file' as any, targetType: targetType as any, targetId, relation: relation as any },
    });
    idSets.push(found.map(e => e.sourceId));
  }

  if (projectId) await addFilter('project', projectId, 'belongs_to');
  if (collectionId) await addFilter('collection', collectionId, 'belongs_to');
  if (organismId) await addFilter('organism', organismId, 'from_organism');

  const filteredFileIds: string[] | null = idSets.length === 0
    ? null
    : idSets.reduce((acc, set) => acc.filter(id => set.includes(id)));

  const repo = AppDataSource.getRepository(GenomicFile);
  let qb = repo.createQueryBuilder('f').orderBy('f.uploaded_at', 'DESC');

  if (filteredFileIds !== null) {
    if (!filteredFileIds.length) { res.json([]); return; }
    qb = qb.where('f.id IN (:...ids)', { ids: filteredFileIds });
  }

  if (kind) {
    qb = filteredFileIds !== null
      ? qb.andWhere('f.kind = :kind', { kind })
      : qb.where('f.kind = :kind', { kind });
  }

  const files = await qb.getMany();
  if (!files.length) { res.json([]); return; }

  const fileIds = files.map(f => f.id);

  // Load all edges FROM these files
  const allEdges = await edgeRepo.createQueryBuilder('e')
    .where('e.source_type = :st AND e.source_id IN (:...ids)', { st: 'file', ids: fileIds })
    .getMany();

  // Build maps — many-to-many for collections
  const projectIdByFile = new Map<string, string>();
  const collectionIdsByFile = new Map<string, string[]>();
  const organismIdByFile = new Map<string, string>();

  for (const e of allEdges) {
    if (e.relation === 'belongs_to' && e.targetType === 'project') projectIdByFile.set(e.sourceId, e.targetId);
    if (e.relation === 'belongs_to' && e.targetType === 'collection') {
      const arr = collectionIdsByFile.get(e.sourceId) ?? [];
      arr.push(e.targetId);
      collectionIdsByFile.set(e.sourceId, arr);
    }
    if (e.relation === 'from_organism') organismIdByFile.set(e.sourceId, e.targetId);
  }

  // Load related entities
  const allProjectIds = [...new Set(projectIdByFile.values())];
  const allColIds = [...new Set([...collectionIdsByFile.values()].flat())];
  const allOrgIds = [...new Set(organismIdByFile.values())];

  const projectMap = new Map<string, Project>();
  const colMap = new Map<string, Collection>();
  const orgMap = new Map<string, Organism>();

  if (allProjectIds.length) {
    const projects = await AppDataSource.getRepository(Project).findByIds(allProjectIds);
    projects.forEach(p => projectMap.set(p.id, p));
  }
  if (allColIds.length) {
    const cols = await AppDataSource.getRepository(Collection).findByIds(allColIds);
    cols.forEach(c => colMap.set(c.id, c));
  }
  if (allOrgIds.length) {
    const orgs = await AppDataSource.getRepository(Organism).findByIds(allOrgIds);
    orgs.forEach(o => orgMap.set(o.id, o));
  }

  res.json(files.map(f => {
    const pId = projectIdByFile.get(f.id);
    const oId = organismIdByFile.get(f.id);
    const colIds = collectionIdsByFile.get(f.id) ?? [];

    return {
      id:          f.id,
      projectId:   pId ?? null,
      projectName: pId ? projectMap.get(pId)?.name ?? null : null,
      filename:    f.filename,
      s3Key:       f.s3Key,
      sizeBytes:   Number(f.sizeBytes),
      format:      f.format,
      kind:        f.kind,
      md5:         f.md5,
      status:      f.status,
      uploadedAt:  f.uploadedAt,
      description: f.description,
      tags:        f.tags,
      organismId:  oId ?? null,
      organismDisplay: oId ? (orgMap.get(oId) ? organismDisplay(orgMap.get(oId)!) : null) : null,
      collections: colIds.map(cId => ({ id: cId, name: colMap.get(cId)?.name ?? null })),
      uploadedBy:  f.uploadedBy,
    };
  }));
}));

// ─── File detail ────────────────────────────────────────────

router.get('/:id', asyncWrap(async (req, res) => {
  // Avoid matching /:id/download or /:id/provenance
  if (req.params.id === 'download' || req.params.id === 'provenance') return;

  const repo = AppDataSource.getRepository(GenomicFile);
  const file = await repo.findOneBy({ id: req.params.id });
  if (!file) { res.status(404).json({ error: 'not found' }); return; }

  // All edges touching this file
  const neighborhood = await edges.getNeighborhood({ type: 'file', id: file.id });

  const collectionIds: string[] = [];
  const projectIds: string[] = [];
  let organismId: string | null = null;
  const provenanceUp: { fileId: string; relation: string; edgeId: string }[] = [];
  const provenanceDown: { fileId: string; relation: string; edgeId: string }[] = [];
  const linkEdges: EntityEdge[] = [];

  for (const e of neighborhood) {
    if (e.sourceId === file.id && e.sourceType === 'file') {
      if (e.relation === 'belongs_to' && e.targetType === 'collection') collectionIds.push(e.targetId);
      if (e.relation === 'belongs_to' && e.targetType === 'project') projectIds.push(e.targetId);
      if (e.relation === 'from_organism') organismId = e.targetId;
      if (PROVENANCE_RELATIONS.includes(e.relation)) {
        provenanceUp.push({ fileId: e.targetId, relation: e.relation, edgeId: e.id });
      }
      if (e.relation === 'links_to') linkEdges.push(e);
    } else if (e.targetId === file.id && e.targetType === 'file') {
      if (PROVENANCE_RELATIONS.includes(e.relation)) {
        provenanceDown.push({ fileId: e.sourceId, relation: e.relation, edgeId: e.id });
      }
    }
  }

  // Load related entities
  const collections = collectionIds.length
    ? await AppDataSource.getRepository(Collection).findByIds(collectionIds)
    : [];
  const projects = projectIds.length
    ? await AppDataSource.getRepository(Project).findByIds(projectIds)
    : [];
  const organism = organismId
    ? await AppDataSource.getRepository(Organism).findOneBy({ id: organismId })
    : null;

  // Load provenance files
  const allProvFileIds = [...new Set([
    ...provenanceUp.map(p => p.fileId),
    ...provenanceDown.map(p => p.fileId),
  ])];
  const provFiles = allProvFileIds.length
    ? await repo.findByIds(allProvFileIds)
    : [];
  const provFileMap = new Map(provFiles.map(f => [f.id, f]));

  res.json({
    id: file.id,
    filename: file.filename,
    s3Key: file.s3Key,
    sizeBytes: Number(file.sizeBytes),
    format: file.format,
    kind: file.kind,
    md5: file.md5,
    status: file.status,
    description: file.description,
    tags: file.tags,
    uploadedBy: file.uploadedBy,
    uploadedAt: file.uploadedAt,
    collections: collections.map(c => ({ id: c.id, name: c.name, kind: c.kind })),
    projects: projects.map(p => ({ id: p.id, name: p.name })),
    organismId,
    organismDisplay: organism ? organismDisplay(organism) : null,
    provenance: {
      upstream: provenanceUp.map(p => {
        const f = provFileMap.get(p.fileId);
        return {
          edgeId: p.edgeId,
          relation: p.relation,
          file: f ? { id: f.id, filename: f.filename, kind: f.kind, format: f.format } : null,
        };
      }),
      downstream: provenanceDown.map(p => {
        const f = provFileMap.get(p.fileId);
        return {
          edgeId: p.edgeId,
          relation: p.relation,
          file: f ? { id: f.id, filename: f.filename, kind: f.kind, format: f.format } : null,
        };
      }),
    },
    links: linkEdges.map(e => ({
      id: e.id,
      url: (e.metadata as any)?.url ?? '',
      service: (e.metadata as any)?.service ?? 'link',
      label: (e.metadata as any)?.label ?? null,
      createdAt: e.createdAt,
    })),
  });
}));

// ─── Update file ────────────────────────────────────────────

router.put('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(GenomicFile);
  const file = await repo.findOneBy({ id: req.params.id });
  if (!file) { res.status(404).json({ error: 'not found' }); return; }

  const { kind, organismId, description, tags } = req.body as Partial<{
    kind: string; organismId: string | null;
    description: string | null; tags: string[];
  }>;

  if (kind !== undefined) file.kind = kind;
  if (description !== undefined) file.description = description;
  if (tags !== undefined) file.tags = tags;
  await repo.save(file);

  if (organismId !== undefined) {
    const edgeRepo = AppDataSource.getRepository(EntityEdge);
    await edgeRepo.delete({ sourceType: 'file' as any, sourceId: file.id, targetType: 'organism' as any, relation: 'from_organism' as any });
    if (organismId) {
      await edges.link({ type: 'file', id: file.id }, { type: 'organism', id: organismId }, 'from_organism');
    }
  }

  res.json(file);
}));

// ─── Add provenance edge ────────────────────────────────────

router.post('/:id/provenance', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(GenomicFile);
  const file = await repo.findOneBy({ id: req.params.id });
  if (!file) { res.status(404).json({ error: 'not found' }); return; }

  const { targetFileId, relation } = req.body as { targetFileId: string; relation: string };
  if (!targetFileId || !relation) {
    res.status(400).json({ error: 'targetFileId and relation required' }); return;
  }
  if (!PROVENANCE_RELATIONS.includes(relation)) {
    res.status(400).json({ error: `relation must be one of: ${PROVENANCE_RELATIONS.join(', ')}` }); return;
  }

  const target = await repo.findOneBy({ id: targetFileId });
  if (!target) { res.status(404).json({ error: 'target file not found' }); return; }

  const userId = (res.locals.user as User)?.id ?? null;
  const edge = await edges.link(
    { type: 'file', id: file.id },
    { type: 'file', id: targetFileId },
    relation as EdgeRelation,
    null,
    userId,
  );
  res.status(201).json(edge);
}));

// ─── Remove provenance edge ────────────────────────────────

router.delete('/:id/provenance/:edgeId', asyncWrap(async (req, res) => {
  const edgeRepo = AppDataSource.getRepository(EntityEdge);
  const edge = await edgeRepo.findOneBy({ id: req.params.edgeId });
  if (!edge) { res.status(404).json({ error: 'not found' }); return; }
  await edgeRepo.remove(edge);
  res.json({ ok: true });
}));

// ─── Delete file ────────────────────────────────────────────

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(GenomicFile);
  const file = await repo.findOneBy({ id: req.params.id });
  if (!file) { res.status(404).json({ error: 'not found' }); return; }

  await deleteObject(file.s3Key);
  await edges.cascadeDelete({ type: 'file', id: file.id });
  await repo.remove(file);
  res.json({ ok: true });
}));

// ─── Download presigned URL ────────────────────────────────

router.get('/:id/download', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(GenomicFile);
  const file = await repo.findOneBy({ id: req.params.id });
  if (!file) { res.status(404).json({ error: 'not found' }); return; }

  const url = await presignDownloadUrl(file.s3Key, file.filename);
  res.json({ url });
}));

export default router;
