-- Re-detect file formats from filenames.
-- Previous logic fell back to 'other' for unrecognized extensions.
-- New logic: format = the file extension itself (gz-aware).

UPDATE genomic_files SET format =
  CASE
    -- Strip .gz and get the extension underneath
    WHEN lower(filename) LIKE '%.gz' THEN
      CASE
        WHEN lower(filename) LIKE '%.%.gz' THEN
          reverse(split_part(reverse(regexp_replace(lower(filename), '\.gz$', '')), '.', 1))
        ELSE 'other'
      END
    -- Normal extension
    WHEN filename LIKE '%.%' THEN
      reverse(split_part(reverse(lower(filename)), '.', 1))
    ELSE 'other'
  END
WHERE format = 'other' OR format IS NULL;
