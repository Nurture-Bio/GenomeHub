import { Router, type Request, type Response, type NextFunction } from 'express';
import { AppDataSource } from '../app_data.js';
import { Organism, EntityEdge } from '../entities/index.js';

const router = Router();

function asyncWrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
}

router.get('/', asyncWrap(async (_req, res) => {
  const repo = AppDataSource.getRepository(Organism);
  const organisms = await repo.find({ order: { createdAt: 'DESC' } });

  const edgeRepo = AppDataSource.getRepository(EntityEdge);

  // File counts via edges (file → organism via from_organism)
  const fileCounts = await edgeRepo
    .createQueryBuilder('e')
    .select('e.target_id', 'organismId')
    .addSelect('COUNT(*)', 'fileCount')
    .where("e.source_type = 'file' AND e.target_type = 'organism' AND e.relation = 'from_organism'")
    .groupBy('e.target_id')
    .getRawMany<{ organismId: string; fileCount: string }>();
  const fileMap = new Map(fileCounts.map(s => [s.organismId, parseInt(s.fileCount)]));

  // Experiment counts via edges (experiment → organism via targets)
  const expCounts = await edgeRepo
    .createQueryBuilder('e')
    .select('e.target_id', 'organismId')
    .addSelect('COUNT(*)', 'experimentCount')
    .where("e.source_type = 'experiment' AND e.target_type = 'organism' AND e.relation = 'targets'")
    .groupBy('e.target_id')
    .getRawMany<{ organismId: string; experimentCount: string }>();
  const expMap = new Map(expCounts.map(s => [s.organismId, parseInt(s.experimentCount)]));

  res.json(organisms.map(o => ({
    ...o,
    displayName: `${o.genus.charAt(0)}. ${o.species}${o.strain ? ' ' + o.strain : ''}`,
    fileCount: fileMap.get(o.id) ?? 0,
    experimentCount: expMap.get(o.id) ?? 0,
  })));
}));

router.post('/', asyncWrap(async (req, res) => {
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

router.delete('/:id', asyncWrap(async (req, res) => {
  const repo = AppDataSource.getRepository(Organism);
  const org = await repo.findOneBy({ id: req.params.id });
  if (!org) { res.status(404).json({ error: 'not found' }); return; }
  await repo.remove(org);
  res.json({ ok: true });
}));

export default router;
