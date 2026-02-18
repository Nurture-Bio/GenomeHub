/**
 * TypeORM entities for GenomeHub.
 *
 * Knowledge-graph model: all relationships live in entity_edges.
 * Core entities: Project, Experiment, Dataset, GenomicFile, Organism, ExperimentType.
 *
 * @module
 */

import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Unique,
} from 'typeorm';

// ─── User ─────────────────────────────────────────────────

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'google_id', type: 'text', unique: true })
  googleId!: string;

  @Column({ type: 'text', unique: true })
  email!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'given_name', type: 'text', nullable: true })
  givenName!: string | null;

  @Column({ name: 'family_name', type: 'text', nullable: true })
  familyName!: string | null;

  @Column({ type: 'text', nullable: true })
  picture!: string | null;

  @Column({ type: 'text', nullable: true })
  hd!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @Column({ name: 'auth_token', type: 'text', nullable: true, unique: true })
  authToken!: string | null;
}

// ─── Project ───────────────────────────────────────────────

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

// ─── Organism ─────────────────────────────────────────────

@Entity('organisms')
@Unique(['genus', 'species', 'strain'])
export class Organism {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  genus!: string;

  @Column({ type: 'text' })
  species!: string;

  @Column({ type: 'text', nullable: true })
  strain!: string | null;

  @Column({ name: 'common_name', type: 'text', nullable: true })
  commonName!: string | null;

  @Column({ name: 'ncbi_tax_id', type: 'int', nullable: true })
  ncbiTaxId!: number | null;

  @Column({ name: 'reference_genome', type: 'text', nullable: true })
  referenceGenome!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

// ─── ExperimentType ───────────────────────────────────────

@Entity('experiment_types')
export class ExperimentType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'default_tags', type: 'text', array: true, default: '{}' })
  defaultTags!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

// ─── Experiment ───────────────────────────────────────────

export type ExperimentStatus = 'active' | 'complete' | 'archived';

@Entity('experiments')
export class Experiment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({
    type: 'text',
    enum: ['active', 'complete', 'archived'],
    default: 'active',
  })
  status!: ExperimentStatus;

  @Column({ name: 'experiment_date', type: 'date', nullable: true })
  experimentDate!: string | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

// ─── Dataset ─────────────────────────────────────────────

export type DatasetKind = 'sample' | 'library' | 'reference' | 'pool' | 'control' | 'other';

@Entity('datasets')
export class Dataset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({
    type: 'text',
    default: 'sample',
  })
  kind!: DatasetKind;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', nullable: true })
  condition!: string | null;

  @Column({ type: 'int', nullable: true })
  replicate!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'text', array: true, default: '{}' })
  tags!: string[];

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

// ─── EntityEdge ──────────────────────────────────────────

export type EntityType = 'project' | 'experiment' | 'dataset' | 'file' | 'organism';
export type EdgeRelation =
  | 'belongs_to' | 'has_type' | 'targets' | 'from_organism'
  | 'derived_from' | 'sequenced_from' | 'produced_by'
  | 'links_to' | 'references';

@Entity('entity_edges')
export class EntityEdge {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source_type', type: 'text' })
  sourceType!: EntityType;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId!: string;

  @Column({ name: 'target_type', type: 'text' })
  targetType!: EntityType;

  @Column({ name: 'target_id', type: 'uuid' })
  targetId!: string;

  @Column({ type: 'text' })
  relation!: EdgeRelation;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

// ─── GenomicFile ─────────────────────────────────────────

export type FileStatus = 'pending' | 'ready' | 'error';

@Entity('genomic_files')
export class GenomicFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  filename!: string;

  @Column({ name: 's3_key', type: 'text' })
  s3Key!: string;

  /** S3 multipart upload ID — cleared once complete */
  @Column({ name: 'upload_id', type: 'text', nullable: true })
  uploadId!: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes!: number;

  @Column({ type: 'text', default: 'other' })
  format!: string;

  @Column({ type: 'text', nullable: true })
  md5!: string | null;

  @Column({
    type: 'text',
    enum: ['pending', 'ready', 'error'],
    default: 'pending',
  })
  status!: FileStatus;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Stored as PostgreSQL text[] */
  @Column({ type: 'text', array: true, default: '{}' })
  tags!: string[];

  @Column({ name: 'uploaded_by', type: 'text', nullable: true })
  uploadedBy!: string | null;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
