import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────

export interface Project {
  id:          string;
  name:        string;
  description: string | null;
  createdAt:   string;
  fileCount:   number;
  totalBytes:  number;
}

export interface GenomicFile {
  id:          string;
  projectId:   string;
  projectName: string;
  filename:    string;
  s3Key:       string;
  sizeBytes:   number;
  format:      string;
  md5:         string | null;
  status:      'pending' | 'ready' | 'error';
  uploadedAt:  string;
  description: string | null;
  tags:        string[];
}

export interface StorageStats {
  totalFiles:  number;
  totalBytes:  number;
  byFormat:    { format: string; count: number; bytes: number }[];
}

// ─── Files ────────────────────────────────────────────────

export function useFilesQuery(projectId?: string) {
  const [data, setData] = useState<GenomicFile[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    setIsLoading(true);
    const url = projectId ? `/api/files?projectId=${projectId}` : '/api/files';
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [projectId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

// ─── Projects ─────────────────────────────────────────────

export function useProjectsQuery() {
  const [data, setData] = useState<Project[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    setIsLoading(true);
    fetch('/api/projects')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

// ─── Storage stats ────────────────────────────────────────

export function useStorageStats() {
  const [data, setData] = useState<StorageStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/stats')
      .then(r => r.json())
      .then(setData)
      .finally(() => setIsLoading(false));
  }, []);

  return { data, isLoading };
}

// ─── Delete file ──────────────────────────────────────────

export function useDeleteFileMutation(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);

  const deleteFile = useCallback(async (fileId: string) => {
    setPending(true);
    try {
      const r = await fetch(`/api/files/${fileId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      onSuccess?.();
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { deleteFile, pending };
}

// ─── Presigned URL ────────────────────────────────────────

export function usePresignedUrl() {
  const [pending, setPending] = useState(false);

  const getUrl = useCallback(async (fileId: string): Promise<string> => {
    setPending(true);
    try {
      const r = await fetch(`/api/files/${fileId}/download`);
      const { url } = await r.json();
      return url;
    } finally {
      setPending(false);
    }
  }, []);

  return { getUrl, pending };
}

// ─── Multipart upload ─────────────────────────────────────

export interface UploadProgress {
  fileId:   string;
  filename: string;
  loaded:   number;
  total:    number;
  status:   'uploading' | 'done' | 'error';
  error?:   string;
}

export function useMultipartUpload() {
  const [uploads, setUploads] = useState<Map<string, UploadProgress>>(new Map());

  const updateUpload = useCallback((id: string, patch: Partial<UploadProgress>) => {
    setUploads(prev => {
      const next = new Map(prev);
      const cur = next.get(id);
      if (cur) next.set(id, { ...cur, ...patch });
      return next;
    });
  }, []);

  const upload = useCallback(async (
    file:      File,
    projectId: string,
    description?: string,
    tags?: string[]
  ) => {
    const tmpId = crypto.randomUUID();

    setUploads(prev => {
      const next = new Map(prev);
      next.set(tmpId, {
        fileId: tmpId, filename: file.name,
        loaded: 0, total: file.size, status: 'uploading',
      });
      return next;
    });

    try {
      // 1. Initiate multipart upload
      const initRes = await fetch('/api/uploads/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name, projectId,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size, description, tags,
        }),
      });
      const { fileId, uploadId, s3Key } = await initRes.json();
      updateUpload(tmpId, { fileId });

      // 2. Upload parts (5MB each)
      const PART_SIZE = 5 * 1024 * 1024;
      const partCount  = Math.ceil(file.size / PART_SIZE);
      const parts: { PartNumber: number; ETag: string }[] = [];

      for (let i = 0; i < partCount; i++) {
        const start  = i * PART_SIZE;
        const end    = Math.min(start + PART_SIZE, file.size);
        const chunk  = file.slice(start, end);

        // Get presigned URL for this part
        const partRes = await fetch('/api/uploads/part-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileId, uploadId, s3Key, partNumber: i + 1 }),
        });
        const { url } = await partRes.json();

        const putRes = await fetch(url, {
          method: 'PUT',
          body: chunk,
          headers: { 'Content-Type': 'application/octet-stream' },
        });

        const etag = putRes.headers.get('ETag') ?? '';
        parts.push({ PartNumber: i + 1, ETag: etag });
        updateUpload(tmpId, { loaded: end });
      }

      // 3. Complete
      await fetch('/api/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, uploadId, s3Key, parts }),
      });

      updateUpload(tmpId, { status: 'done', loaded: file.size });
    } catch (err: unknown) {
      updateUpload(tmpId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      });
    }
  }, [updateUpload]);

  const clearDone = useCallback(() => {
    setUploads(prev => {
      const next = new Map(prev);
      for (const [k, v] of next) {
        if (v.status === 'done') next.delete(k);
      }
      return next;
    });
  }, []);

  return { uploads, upload, clearDone };
}
