-- Drop projects table and clean up entity_edges referencing projects.
-- Files that belonged to projects keep their S3 keys (they already have
-- unique paths), so no object moves needed.

DELETE FROM entity_edges WHERE source_type = 'project' OR target_type = 'project';
DROP TABLE IF EXISTS projects CASCADE;
