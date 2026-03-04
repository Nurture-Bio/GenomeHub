/**
 * TypeORM entities for GenomeHub.
 *
 * Knowledge-graph model: all relationships live in entity_edges.
 * Core entities: Collection, GenomicFile, Organism, Technique.
 *
 * @module
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import type { DataProfile } from '@genome-hub/shared';

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

// ─── Technique ───────────────────────────────────────────
// Sequencing techniques (ChIP-seq, RNA-seq, etc.). Reference data
// linked to collections via has_type edges.

@Entity('techniques')
export class Technique {
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

// ─── Collection ──────────────────────────────────────────
// A named group of files. Type determines what type of collection
// (experiment, batch, analysis, custom, etc.). Type-specific
// fields live in JSONB metadata — no hardcoded columns.

@Entity('collections')
export class Collection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  type!: string[];

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

// ─── FileType ───────────────────────────────────────────
// First-class entity — users manage these through the UX.

@Entity('file_types')
export class FileType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

// ─── RelationType ───────────────────────────────────────
// First-class entity — users manage these through the UX.

@Entity('relation_types')
export class RelationType {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

// ─── Engine ─────────────────────────────────────────────
// External analysis services that GenomeHub can reach.
// Managed through Settings UI. Health polled at runtime.

@Entity('engines')
export class Engine {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'text' })
  url!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

// ─── EntityEdge ──────────────────────────────────────────

export type EntityType = 'collection' | 'file' | 'organism' | 'technique';
// EdgeRelation kept as a type alias for internal/system edges.
// User-facing relation types live in the relation_types table.
export type EdgeRelation = string;

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

  @Column({ type: 'text', array: true, default: () => "'{raw}'" })
  type!: string[];

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

  /** S3 key for the Parquet sidecar (converted from JSON at upload time) */
  @Column({ name: 'parquet_s3_key', type: 'text', nullable: true })
  parquetS3Key!: string | null;

  /** Parquet conversion status: converting → ready | failed */
  @Column({ name: 'parquet_status', type: 'text', nullable: true })
  parquetStatus!: string | null;

  /** Error message from failed Parquet conversion (null when status != 'failed') */
  @Column({ name: 'parquet_error', type: 'text', nullable: true })
  parquetError!: string | null;

  /**
   * Computed metadata bag — schema, row count, column stats, cardinality,
   * and any future attributes. One JSONB column, zero future migrations.
   * Populated lazily on first client request for each attribute.
   */
  @Column({ name: 'data_profile', type: 'jsonb', nullable: true })
  dataProfile!: DataProfile | null;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
