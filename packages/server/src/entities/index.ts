/**
 * TypeORM entities — matching the GuildSpace convention of
 * one class per file, decorated with @Entity / @Column etc.
 *
 * @module
 */

import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';

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

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
