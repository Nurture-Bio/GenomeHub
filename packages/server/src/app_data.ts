import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Project, GenomicFile } from './entities/index.js';

export const AppDataSource = new DataSource({
  type:     'postgres',
  url:      process.env.DATABASE_URL,
  entities: [Project, GenomicFile],
  migrations: ['dist/migrations/*.js'],
  synchronize: process.env.NODE_ENV === 'development',
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  logging: process.env.NODE_ENV === 'development',
});
