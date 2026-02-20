-- Rename "kind" column to "type" on genomic_files and collections.
-- Also rename file_kinds table to file_types.

ALTER TABLE genomic_files RENAME COLUMN kind TO type;
ALTER TABLE collections  RENAME COLUMN kind TO type;
ALTER TABLE file_kinds   RENAME TO file_types;
