/**
 * TypeORM entities — matching the GuildSpace convention of
 * one class per file, decorated with @Entity / @Column etc.
 *
 * @module
 */

import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index, Unique,
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

// ─── Experiment ───────────────────────────────────────────

@Entity('experiments')
@Index(['projectId'])
@Index(['organismId'])
export class Experiment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', unique: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text' })
  technique!: string;

  @Column({ name: 'experiment_date', type: 'date', nullable: true })
  experimentDate!: string | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

  @Column({ name: 'organism_id', type: 'uuid', nullable: true })
  organismId!: string | null;

  @ManyToOne(() => Organism, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'organism_id' })
  organism!: Organism | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}

// ─── GenomicFile ───────────────────────────────────────────

export type FileStatus = 'pending' | 'ready' | 'error';

@Entity('genomic_files')
@Index(['projectId'])
@Index(['format'])
export class GenomicFile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'project_id', type: 'uuid' })
  projectId!: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project!: Project;

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

  @Column({ name: 'organism_id', type: 'uuid', nullable: true })
  organismId!: string | null;

  @ManyToOne(() => Organism, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'organism_id' })
  organism!: Organism | null;

  @Column({ name: 'experiment_id', type: 'uuid', nullable: true })
  experimentId!: string | null;

  @ManyToOne(() => Experiment, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'experiment_id' })
  experiment!: Experiment | null;

  @Column({ name: 'uploaded_by', type: 'text', nullable: true })
  uploadedBy!: string | null;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
