import { Router } from 'express';
import { AppDataSource } from '../app_data.js';
import { Organism, EntityEdge } from '../entities/index.js';
import { asyncWrap } from '../lib/async_wrap.js';
import { organismDisplay } from '../lib/display.js';
import * as edges from '../lib/edge_service.js';

const router = Router();

router.get(
  '/',
  asyncWrap(async (_req, res) => {
    const repo = AppDataSource.getRepository(Organism);
    const organisms = await repo.find({ order: { createdAt: 'DESC' } });

    const edgeRepo = AppDataSource.getRepository(EntityEdge);

    // File counts via edges (file → organism via from_organism)
    const fileCounts = await edgeRepo
      .createQueryBuilder('e')
      .select('e.target_id', 'organismId')
      .addSelect('COUNT(*)', 'fileCount')
      .where(
        "e.source_type = 'file' AND e.target_type = 'organism' AND e.relation = 'from_organism'",
      )
      .groupBy('e.target_id')
      .getRawMany<{ organismId: string; fileCount: string }>();
    const fileMap = new Map(fileCounts.map((s) => [s.organismId, parseInt(s.fileCount)]));

    // Collection counts via edges (collection → organism via targets)
    const colCounts = await edgeRepo
      .createQueryBuilder('e')
      .select('e.target_id', 'organismId')
      .addSelect('COUNT(*)', 'collectionCount')
      .where(
        "e.source_type = 'collection' AND e.target_type = 'organism' AND e.relation = 'targets'",
      )
      .groupBy('e.target_id')
      .getRawMany<{ organismId: string; collectionCount: string }>();
    const colMap = new Map(colCounts.map((s) => [s.organismId, parseInt(s.collectionCount)]));

    res.json(
      organisms.map((o) => ({
        ...o,
        displayName: organismDisplay(o),
        fileCount: fileMap.get(o.id) ?? 0,
        collectionCount: colMap.get(o.id) ?? 0,
      })),
    );
  }),
);

router.post(
  '/',
  asyncWrap(async (req, res) => {
    const { genus, species, strain, commonName, ncbiTaxId, referenceGenome } = req.body as {
      genus: string;
      species: string;
      strain?: string;
      commonName?: string;
      ncbiTaxId?: number;
      referenceGenome?: string;
    };
    if (!genus || !species) {
      res.status(400).json({ error: 'genus and species required' });
      return;
    }

    const repo = AppDataSource.getRepository(Organism);
    const org = repo.create({
      genus,
      species,
      strain: strain ?? null,
      commonName: commonName ?? null,
      ncbiTaxId: ncbiTaxId ?? null,
      referenceGenome: referenceGenome ?? null,
    });
    await repo.save(org);
    res.status(201).json(org);
  }),
);

router.put(
  '/:id',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(Organism);
    const org = await repo.findOneBy({ id: req.params.id });
    if (!org) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const { genus, species, strain, commonName, ncbiTaxId, referenceGenome } = req.body as Partial<{
      genus: string;
      species: string;
      strain: string | null;
      commonName: string | null;
      ncbiTaxId: number | null;
      referenceGenome: string | null;
    }>;
    if (genus !== undefined) org.genus = genus;
    if (species !== undefined) org.species = species;
    if (strain !== undefined) org.strain = strain;
    if (commonName !== undefined) org.commonName = commonName;
    if (ncbiTaxId !== undefined) org.ncbiTaxId = ncbiTaxId;
    if (referenceGenome !== undefined) org.referenceGenome = referenceGenome;
    await repo.save(org);
    res.json(org);
  }),
);

router.delete(
  '/:id',
  asyncWrap(async (req, res) => {
    const repo = AppDataSource.getRepository(Organism);
    const org = await repo.findOneBy({ id: req.params.id });
    if (!org) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const refs = await edges.countReferences({ type: 'organism', id: org.id });
    if (refs > 0) {
      res.status(409).json({
        error: `Cannot delete: ${refs} file(s) or collection(s) still reference this organism.`,
      });
      return;
    }
    await repo.remove(org);
    res.json({ ok: true });
  }),
);

export default router;
