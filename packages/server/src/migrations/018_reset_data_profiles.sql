-- Reset data_profile for all files so they get re-profiled with DESCRIBE
-- (logical types) instead of the old parquet_schema() (physical types).
UPDATE genomic_files SET data_profile = NULL WHERE data_profile IS NOT NULL;
