import { Router } from 'express';
import { AppDataSource } from '../app_data.js';
import { GenomicFile } from '../entities/index.js';
import { asyncWrap } from '../lib/async_wrap.js';

const router = Router();

router.get(
  '/',
  asyncWrap(async (_req, res) => {
    const repo = AppDataSource.getRepository(GenomicFile);
    const totals = await repo
      .createQueryBuilder('f')
      .select('COUNT(*)', 'totalFiles')
      .addSelect('SUM(f.size_bytes)', 'totalBytes')
      .where("f.status = 'ready'")
      .getRawOne<{ totalFiles: string; totalBytes: string }>();

    const byFmt = await repo
      .createQueryBuilder('f')
      .select('f.format', 'format')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(f.size_bytes)', 'bytes')
      .where("f.status = 'ready'")
      .groupBy('f.format')
      .orderBy('bytes', 'DESC')
      .getRawMany<{ format: string; count: string; bytes: string }>();

    res.json({
      totalFiles: parseInt(totals?.totalFiles ?? '0'),
      totalBytes: parseInt(totals?.totalBytes ?? '0'),
      byFormat: byFmt.map((r) => ({
        format: r.format,
        count: parseInt(r.count),
        bytes: parseInt(r.bytes),
      })),
    });
  }),
);

export default router;
