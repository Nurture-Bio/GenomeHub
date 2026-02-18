import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User, Project, Organism, Technique, Collection, EntityEdge, GenomicFile } from './entities/index.js';

export function buildDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.host && parsed.username && parsed.password) {
      const port = parsed.port ?? 5432;
      const dbname = parsed.dbname ?? 'genome_hub';
      return `postgresql://${encodeURIComponent(parsed.username)}:${encodeURIComponent(parsed.password)}@${parsed.host}:${port}/${dbname}`;
    }
  } catch {
    // Not JSON — use raw value as-is (local dev connection string)
  }
  return raw;
}

export const AppDataSource = new DataSource({
  type:     'postgres',
  url:      buildDatabaseUrl(process.env.DATABASE_URL),
  entities: [User, Project, Organism, Technique, Collection, EntityEdge, GenomicFile],
  migrations: ['dist/migrations/*.js'],
  synchronize: process.env.NODE_ENV === 'development',
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  logging: process.env.NODE_ENV === 'development',
});
