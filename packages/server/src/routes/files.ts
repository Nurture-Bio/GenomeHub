import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { GenomicFile, EntityEdge, Organism, Experiment, Dataset, Project } from '../entities/index.js';
import { deleteObject, presignDownloadUrl } from '../lib/s3.js';
import * as edges from '../lib/edge_service.js';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

function organismDisplay(o: Organism): string {
  return `${o.genus.charAt(0)}. ${o.species}${o.strain ? ' ' + o.strain : ''}`;
}

// ─── List files ─────────────────────────────────────────────

router.get('/', asyncWrap(async (req, res) => {
  const { projectId, organismId, experimentId, datasetId } = req.query as {
    projectId?: string; organismId?: string; experimentId?: string; datasetId?: string;
  };

  const edgeRepo = AppDataSource.getRepository(EntityEdge);

  // Collect ID sets from each filter, then intersect
  const idSets: string[][] = [];

  async function addFilter(targetType: string, targetId: string, relation: string) {
    const edges = await edgeRepo.find({
      where: { sourceType: 'file' as any, targetType: targetType as any, targetId, relation: relation as any },
    });
    idSets.push(edges.map(e => e.sourceId));
  }

  if (projectId) await addFilter('project', projectId, 'belongs_to');
  if (experimentId) await addFilter('experiment', experimentId, 'belongs_to');
  if (datasetId) await addFilter('dataset', datasetId, 'belongs_to');
  if (organismId) await addFilter('organism', organismId, 'from_organism');

  const filteredFileIds: string[] | null = idSets.length === 0
    ? null
    : idSets.reduce((acc, set) => acc.filter(id => set.includes(id)));

  const repo = AppDataSource.getRepository(GenomicFile);
  let files: GenomicFile[];

  if (filteredFileIds !== null) {
    files = filteredFileIds.length
      ? await repo.createQueryBuilder('f')
          .where('f.id IN (:...ids)', { ids: filteredFileIds })
          .orderBy('f.uploaded_at', 'DESC')
          .getMany()
      : [];
  } else {
    files = await repo.find({ order: { uploadedAt: 'DESC' } });
  }

  if (!files.length) { res.json([]); return; }

  const fileIds = files.map(f => f.id);

  // Load all edges FROM these files
  const allEdges = await edgeRepo.createQueryBuilder('e')
    .where('e.source_type = :st AND e.source_id IN (:...ids)', { st: 'file', ids: fileIds })
    .getMany();

  // Build maps
  const projectIdByFile = new Map<string, string>();
  const experimentIdByFile = new Map<string, string>();
  const datasetIdByFile = new Map<string, string>();
  const organismIdByFile = new Map<string, string>();

  for (const e of allEdges) {
    if (e.relation === 'belongs_to' && e.targetType === 'project') projectIdByFile.set(e.sourceId, e.targetId);
    if (e.relation === 'belongs_to' && e.targetType === 'experiment') experimentIdByFile.set(e.sourceId, e.targetId);
    if (e.relation === 'belongs_to' && e.targetType === 'dataset') datasetIdByFile.set(e.sourceId, e.targetId);
    if (e.relation === 'from_organism') organismIdByFile.set(e.sourceId, e.targetId);
  }

  // Load related entities
  const allProjectIds = [...new Set(projectIdByFile.values())];
  const allExpIds = [...new Set(experimentIdByFile.values())];
  const allDsIds = [...new Set(datasetIdByFile.values())];
  const allOrgIds = [...new Set(organismIdByFile.values())];

  const projectMap = new Map<string, Project>();
  const expMap = new Map<string, Experiment>();
  const dsMap = new Map<string, Dataset>();
  const orgMap = new Map<string, Organism>();

  if (allProjectIds.length) {
    const projects = await AppDataSource.getRepository(Project).findByIds(allProjectIds);
    projects.forEach(p => projectMap.set(p.id, p));
  }
  if (allExpIds.length) {
    const exps = await AppDataSource.getRepository(Experiment).findByIds(allExpIds);
    exps.forEach(e => expMap.set(e.id, e));
  }
  if (allDsIds.length) {
    const dss = await AppDataSource.getRepository(Dataset).findByIds(allDsIds);
    dss.forEach(d => dsMap.set(d.id, d));
  }
  if (allOrgIds.length) {
    const orgs = await AppDataSource.getRepository(Organism).findByIds(allOrgIds);
    orgs.forEach(o => orgMap.set(o.id, o));
  }

  res.json(files.map(f => {
    const pId = projectIdByFile.get(f.id);
    const eId = experimentIdByFile.get(f.id);
    const dId = datasetIdByFile.get(f.id);
    const oId = organismIdByFile.get(f.id);

    return {
      id:          f.id,
      projectId:   pId ?? null,
      projectName: pId ? projectMap.get(pId)?.name ?? null : null,
      filename:    f.filename,
      s3Key:       f.s3Key,
      sizeBytes:   Number(f.sizeBytes),
      format:      f.format,
      md5:         f.md5,
      status:      f.status,
      uploadedAt:  f.uploadedAt,
      description: f.description,
      tags:        f.tags,
      organismId:  oId ?? null,
      organismDisplay: oId ? (orgMap.get(oId) ? organismDisplay(orgMap.get(oId)!) : null) : null,
      experimentId:   eId ?? null,
      experimentName: eId ? expMap.get(eId)?.name ?? null : null,
      datasetId:      dId ?? null,
      datasetName:    dId ? dsMap.get(dId)?.name ?? null : null,
      uploadedBy:     f.uploadedBy,
    };
  }));
}));

// ─── Update file ────────────────────────────────────────────

router.put('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(GenomicFile);
  const file = await repo.findOneBy({ id: req.params.id });
  if (!file) { res.status(404).json({ error: 'not found' }); return; }

  const { datasetId, experimentId, organismId, description, tags } = req.body as Partial<{
    datasetId: string | null; experimentId: string | null; organismId: string | null;
    description: string | null; tags: string[];
  }>;

  if (description !== undefined) file.description = description;
  if (tags !== undefined) file.tags = tags;
  await repo.save(file);

  const edgeRepo = AppDataSource.getRepository(EntityEdge);

  // Update dataset edge
  if (datasetId !== undefined) {
    await edgeRepo.delete({ sourceType: 'file' as any, sourceId: file.id, targetType: 'dataset' as any, relation: 'belongs_to' as any });
    if (datasetId) {
      await edges.link({ type: 'file', id: file.id }, { type: 'dataset', id: datasetId }, 'belongs_to');
    }
  }

  // Update experiment edge
  if (experimentId !== undefined) {
    await edgeRepo.delete({ sourceType: 'file' as any, sourceId: file.id, targetType: 'experiment' as any, relation: 'belongs_to' as any });
    if (experimentId) {
      await edges.link({ type: 'file', id: file.id }, { type: 'experiment', id: experimentId }, 'belongs_to');
    }
  }

  // Update organism edge
  if (organismId !== undefined) {
    await edgeRepo.delete({ sourceType: 'file' as any, sourceId: file.id, targetType: 'organism' as any, relation: 'from_organism' as any });
    if (organismId) {
      await edges.link({ type: 'file', id: file.id }, { type: 'organism', id: organismId }, 'from_organism');
    }
  }

  res.json(file);
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
