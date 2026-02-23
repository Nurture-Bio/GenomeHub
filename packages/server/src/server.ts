/**
 * GenomeHub server.
 *
 * Express API that:
 *  - Serves the Vite-built client from /dist/client
 *  - Mounts route modules for all API endpoints
 *  - Never buffers file payloads — the browser uploads directly to S3
 *    via presigned multipart URLs; the server only coordinates metadata.
 *
 * @module
 */

import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import { AppDataSource } from './app_data.js';
import { Technique } from './entities/index.js';
import { resolveUser } from './routes/auth.js';
// Route modules
import authRoutes from './routes/auth.js';
import collectionRoutes from './routes/collections.js';
import fileRoutes from './routes/files.js';
import uploadRoutes from './routes/uploads.js';
import organismRoutes from './routes/organisms.js';
import techniqueRoutes from './routes/techniques.js';
import edgeRoutes, { linksRouter } from './routes/edges.js';
import statsRoutes from './routes/stats.js';
import relationTypeRoutes from './routes/relation_types.js';
import fileTypeRoutes from './routes/file_types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // limit each IP to 100 requests per windowMs
});

const app       = express();
const server    = createServer(app);

app.set('trust proxy', 1);
app.use(express.json());

// Prevent CloudFront from caching API responses
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ─── Auth routes (unauthenticated) ──────────────────────────

app.use('/api', authRoutes);

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

// ─── Protected routes ───────────────────────────────────────

app.use('/api/collections', collectionRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/organisms', organismRoutes);
app.use('/api/techniques', techniqueRoutes);
app.use('/api/edges', edgeRoutes);
app.use('/api/links', linksRouter);
app.use('/api/stats', statsRoutes);
app.use('/api/relation-types', relationTypeRoutes);
app.use('/api/file-types', fileTypeRoutes);
// ─── Serve client ──────────────────────────────────────────

const clientDist = path.join(__dirname, '..', '..', '..', 'dist', 'client');
app.use(express.static(clientDist));
app.get('*', fallbackLimiter, (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ─── Error handler ─────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// ─── Boot ──────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3000');

async function runSqlMigrations() {
  const qr = AppDataSource.createQueryRunner();

  // Create tracking table if it doesn't exist
  await qr.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Find SQL migration files
  // In production (Docker): ../migrations relative to dist/
  // In development: ../src/migrations relative to dist/
  const prodDir = path.join(__dirname, '..', 'migrations');
  const devDir = path.join(__dirname, '..', 'src', 'migrations');
  const migrationsDir = fs.existsSync(prodDir) ? prodDir : devDir;
  if (!fs.existsSync(migrationsDir)) {
    await qr.release();
    return;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  if (!files.length) {
    await qr.release();
    return;
  }

  // Check which have been applied
  const applied = await qr.query('SELECT name FROM schema_migrations');
  const appliedSet = new Set(applied.map((r: { name: string }) => r.name));

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    console.log(`Running migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await qr.query(sql);
    await qr.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    console.log(`Migration applied: ${file}`);
  }

  await qr.release();
}

async function seedTechniques() {
  const repo = AppDataSource.getRepository(Technique);
  const count = await repo.count();
  if (count > 0) return;

  const defaults: { name: string; description: string; defaultTags: string[] }[] = [
    { name: 'ChIP-seq',      description: 'Chromatin immunoprecipitation sequencing',              defaultTags: ['fastq', 'bam'] },
    { name: 'ATAC-seq',      description: 'Assay for transposase-accessible chromatin',            defaultTags: ['fastq', 'bam'] },
    { name: 'RNA-seq',       description: 'Transcriptome sequencing',                              defaultTags: ['fastq', 'bam', 'counts'] },
    { name: 'MNase-seq',     description: 'Micrococcal nuclease sequencing',                       defaultTags: ['fastq', 'bam'] },
    { name: 'WGS',           description: 'Whole genome sequencing',                               defaultTags: ['fastq', 'bam', 'vcf'] },
    { name: 'Tn-seq',        description: 'Transposon insertion sequencing',                       defaultTags: ['fastq', 'bam'] },
    { name: 'Hi-C',          description: 'Chromosome conformation capture',                       defaultTags: ['fastq', 'pairs', 'cool'] },
    { name: 'CUT&Tag',       description: 'Cleavage under targets & tagmentation',                 defaultTags: ['fastq', 'bam'] },
    { name: 'CUT&Run',       description: 'Cleavage under targets & release using nuclease',       defaultTags: ['fastq', 'bam'] },
    { name: 'CRISPR-screen', description: 'CRISPR genetic screen',                                 defaultTags: ['fastq', 'counts'] },
    { name: 'Other',         description: 'Other technique',                                       defaultTags: [] },
  ];

  await repo.save(defaults.map(d => repo.create(d)));
  console.log(`Seeded ${defaults.length} techniques`);
}

async function main() {
  await AppDataSource.initialize();
  await runSqlMigrations();
  await seedTechniques();
  console.log('Database connected');

  server.listen(PORT, () => {
    console.log(`GenomeHub listening on http://localhost:${PORT}`);
  });
}

main().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
