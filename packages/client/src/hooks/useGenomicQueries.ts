import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';

// ─── Types ────────────────────────────────────────────────

export interface Project {
  id:          string;
  name:        string;
  description: string | null;
  createdAt:   string;
  fileCount:   number;
  totalBytes:  number;
}

export interface Organism {
  id:              string;
  genus:           string;
  species:         string;
  strain:          string | null;
  commonName:      string | null;
  ncbiTaxId:       number | null;
  referenceGenome: string | null;
  displayName:     string;
  fileCount:       number;
  collectionCount: number;
  createdAt:       string;
}

export interface Collection {
  id:              string;
  name:            string;
  description:     string | null;
  kind:            string;
  metadata:        Record<string, unknown> | null;
  techniqueId:     string | null;
  techniqueName:   string | null;
  createdBy:       string | null;
  projectId:       string | null;
  projectName:     string | null;
  organismId:      string | null;
  organismDisplay: string | null;
  fileCount:       number;
  createdAt:       string;
}

export interface GenomicFile {
  id:              string;
  projectId:       string | null;
  projectName:     string | null;
  filename:        string;
  s3Key:           string;
  sizeBytes:       number;
  format:          string;
  kind:            string;
  md5:             string | null;
  status:          'pending' | 'ready' | 'error';
  uploadedAt:      string;
  description:     string | null;
  tags:            string[];
  organismId:      string | null;
  organismDisplay: string | null;
  collections:     { id: string; name: string | null }[];
  uploadedBy:      string | null;
}

export interface FileDetail {
  id:              string;
  filename:        string;
  s3Key:           string;
  sizeBytes:       number;
  format:          string;
  kind:            string;
  md5:             string | null;
  status:          'pending' | 'ready' | 'error';
  description:     string | null;
  tags:            string[];
  uploadedBy:      string | null;
  uploadedAt:      string;
  collections:     { id: string; name: string; kind: string }[];
  projects:        { id: string; name: string }[];
  organismId:      string | null;
  organismDisplay: string | null;
  provenance: {
    upstream:   ProvenanceEdge[];
    downstream: ProvenanceEdge[];
  };
  links: ExternalLink[];
}

export interface ProvenanceEdge {
  edgeId:   string;
  relation: string;
  file:     { id: string; filename: string; kind: string; format: string } | null;
}

export interface StorageStats {
  totalFiles:  number;
  totalBytes:  number;
  byFormat:    { format: string; count: number; bytes: number }[];
}

export interface Technique {
  id:          string;
  name:        string;
  description: string | null;
  defaultTags: string[];
  createdAt:   string;
}

export type LinkParentType = 'project' | 'collection' | 'file';
export type LinkServiceType =
  | 'jira' | 'confluence' | 'slack'
  | 'google-doc' | 'google-sheet' | 'google-drive'
  | 'github' | 'notion' | 'benchling'
  | 'ncbi' | 'ebi' | 'protocols-io'
  | 'link';

export interface ExternalLink {
  id:         string;
  parentType: LinkParentType;
  parentId:   string;
  url:        string;
  service:    LinkServiceType;
  label:      string | null;
  createdAt:  string;
}

export interface ProjectTree {
  id:          string;
  name:        string;
  description: string | null;
  createdAt:   string;
  fileCount:   number;
  links:       ExternalLink[];
  collections: ProjectTreeCollection[];
}

export interface ProjectTreeCollection {
  id:              string;
  name:            string;
  description:     string | null;
  kind:            string;
  metadata:        Record<string, unknown> | null;
  technique:       { id: string; name: string } | null;
  organismId:      string | null;
  organismDisplay: string | null;
  fileCount:       number;
  links:           ExternalLink[];
  files:           ProjectTreeFile[];
}

export interface ProjectTreeFile {
  id:        string;
  filename:  string;
  kind:      string;
  format:    string;
  sizeBytes: number;
  status:    string;
}

// ─── Files ────────────────────────────────────────────────

export function useFilesQuery(filters?: { projectId?: string; collectionId?: string; kind?: string } | string) {
  const projectId = typeof filters === 'string' ? filters : filters?.projectId;
  const collectionId = typeof filters === 'string' ? undefined : filters?.collectionId;
  const kind = typeof filters === 'string' ? undefined : filters?.kind;

  const [data, setData] = useState<GenomicFile[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (collectionId) params.set('collectionId', collectionId);
    if (kind) params.set('kind', kind);
    const qs = params.toString();
    apiFetch(`/api/files${qs ? '?' + qs : ''}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [projectId, collectionId, kind]);

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
    apiFetch('/api/projects')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

export function useCreateProjectMutation(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);

  const createProject = useCallback(async (body: {
    name: string; description?: string;
  }) => {
    setPending(true);
    try {
      const r = await apiFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Create failed');
      onSuccess?.();
      toast.success('Project created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create project');
      throw err;
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { createProject, pending };
}

// ─── Project tree ─────────────────────────────────────────

export function useProjectTreeQuery(projectId?: string) {
  const [data, setData] = useState<ProjectTree | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    if (!projectId) { setIsLoading(false); return; }
    setIsLoading(true);
    apiFetch(`/api/projects/${projectId}/tree`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [projectId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

// ─── Organisms ────────────────────────────────────────────

export function useOrganismsQuery() {
  const [data, setData] = useState<Organism[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    setIsLoading(true);
    apiFetch('/api/organisms')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

export function useCreateOrganismMutation(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);

  const createOrganism = useCallback(async (body: {
    genus: string; species: string; strain?: string;
    commonName?: string; ncbiTaxId?: number; referenceGenome?: string;
  }) => {
    setPending(true);
    try {
      const r = await apiFetch('/api/organisms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Create failed');
      onSuccess?.();
      toast.success('Organism created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create organism');
      throw err;
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { createOrganism, pending };
}

// ─── Collections ──────────────────────────────────────────

export function useCollectionsQuery(filters?: { projectId?: string; organismId?: string; kind?: string }) {
  const [data, setData] = useState<Collection[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (filters?.projectId) params.set('projectId', filters.projectId);
    if (filters?.organismId) params.set('organismId', filters.organismId);
    if (filters?.kind) params.set('kind', filters.kind);
    const qs = params.toString();
    apiFetch(`/api/collections${qs ? '?' + qs : ''}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [filters?.projectId, filters?.organismId, filters?.kind]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

export interface CollectionDetail {
  id:              string;
  name:            string;
  description:     string | null;
  kind:            string;
  metadata:        Record<string, unknown> | null;
  technique:       { id: string; name: string } | null;
  organismId:      string | null;
  organismDisplay: string | null;
  createdBy:       string | null;
  projectId:       string | null;
  projectName:     string | null;
  fileCount:       number;
  links:           ExternalLink[];
  files:           ProjectTreeFile[];
}

export function useCollectionDetailQuery(collectionId?: string) {
  const [data, setData] = useState<CollectionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    if (!collectionId) { setIsLoading(false); return; }
    setIsLoading(true);
    apiFetch(`/api/collections/${collectionId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [collectionId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

export function useCreateCollectionMutation(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);

  const createCollection = useCallback(async (body: {
    name: string; kind?: string;
    metadata?: Record<string, unknown>;
    projectId?: string; description?: string;
    techniqueId?: string; organismId?: string;
  }) => {
    setPending(true);
    try {
      const r = await apiFetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Create failed');
      onSuccess?.();
      toast.success('Collection created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create collection');
      throw err;
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { createCollection, pending };
}

// ─── Techniques ──────────────────────────────────────────

export function useTechniquesQuery() {
  const [data, setData] = useState<Technique[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    setIsLoading(true);
    apiFetch('/api/techniques')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

export function useCreateTechniqueMutation(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);

  const createTechnique = useCallback(async (body: {
    name: string; description?: string; defaultTags?: string[];
  }) => {
    setPending(true);
    try {
      const r = await apiFetch('/api/techniques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Create failed');
      const data = await r.json() as Technique;
      onSuccess?.();
      toast.success('Technique created');
      return data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create technique');
      throw err;
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { createTechnique, pending };
}

// ─── External links ──────────────────────────────────────

export function useLinksQuery(parentType?: LinkParentType, parentId?: string) {
  const [data, setData] = useState<ExternalLink[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    if (!parentType || !parentId) { setData([]); setIsLoading(false); return; }
    setIsLoading(true);
    apiFetch(`/api/links?parentType=${parentType}&parentId=${parentId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [parentType, parentId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

export function useCreateLinkMutation(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);

  const createLink = useCallback(async (body: {
    parentType: LinkParentType; parentId: string;
    url: string; label?: string;
  }) => {
    setPending(true);
    try {
      const r = await apiFetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Create failed');
      onSuccess?.();
      toast.success('Link added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add link');
      throw err;
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { createLink, pending };
}

export function useDeleteLinkMutation(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);

  const deleteLink = useCallback(async (linkId: string) => {
    setPending(true);
    try {
      const r = await apiFetch(`/api/links/${linkId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      onSuccess?.();
      toast.success('Link removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove link');
      throw err;
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { deleteLink, pending };
}

// ─── Storage stats ────────────────────────────────────────

export function useStorageStats() {
  const [data, setData] = useState<StorageStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/stats')
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
      const r = await apiFetch(`/api/files/${fileId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Delete failed');
      onSuccess?.();
      toast.success('File deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete file');
      throw err;
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { deleteFile, pending };
}

// ─── File detail ──────────────────────────────────────────

export function useFileDetailQuery(fileId?: string) {
  const [data, setData] = useState<FileDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    if (!fileId) { setIsLoading(false); return; }
    setIsLoading(true);
    apiFetch(`/api/files/${fileId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [fileId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

// ─── Collection membership ────────────────────────────────

export function useAddFilesToCollection() {
  const [pending, setPending] = useState(false);

  const addFiles = useCallback(async (collectionId: string, fileIds: string[]) => {
    setPending(true);
    try {
      const r = await apiFetch(`/api/collections/${collectionId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds }),
      });
      if (!r.ok) throw new Error('Failed to add files');
      toast.success(`Added ${fileIds.length} file${fileIds.length !== 1 ? 's' : ''} to collection`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add files');
      throw err;
    } finally {
      setPending(false);
    }
  }, []);

  return { addFiles, pending };
}

export function useRemoveFilesFromCollection() {
  const [pending, setPending] = useState(false);

  const removeFiles = useCallback(async (collectionId: string, fileIds: string[]) => {
    setPending(true);
    try {
      const r = await apiFetch(`/api/collections/${collectionId}/files`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds }),
      });
      if (!r.ok) throw new Error('Failed to remove files');
      toast.success(`Removed ${fileIds.length} file${fileIds.length !== 1 ? 's' : ''} from collection`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove files');
      throw err;
    } finally {
      setPending(false);
    }
  }, []);

  return { removeFiles, pending };
}

// ─── Provenance ───────────────────────────────────────────

export function useAddProvenance() {
  const [pending, setPending] = useState(false);

  const addProvenance = useCallback(async (fileId: string, targetFileId: string, relation: string) => {
    setPending(true);
    try {
      const r = await apiFetch(`/api/files/${fileId}/provenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetFileId, relation }),
      });
      if (!r.ok) throw new Error('Failed to add provenance');
      toast.success('Provenance link added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add provenance');
      throw err;
    } finally {
      setPending(false);
    }
  }, []);

  return { addProvenance, pending };
}

export function useRemoveProvenance() {
  const [pending, setPending] = useState(false);

  const removeProvenance = useCallback(async (fileId: string, edgeId: string) => {
    setPending(true);
    try {
      const r = await apiFetch(`/api/files/${fileId}/provenance/${edgeId}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('Failed to remove provenance');
      toast.success('Provenance link removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove provenance');
      throw err;
    } finally {
      setPending(false);
    }
  }, []);

  return { removeProvenance, pending };
}

// ─── Presigned URL ────────────────────────────────────────

export function usePresignedUrl() {
  const [pending, setPending] = useState(false);

  const getUrl = useCallback(async (fileId: string): Promise<string> => {
    setPending(true);
    try {
      const r = await apiFetch(`/api/files/${fileId}/download`);
      const { url } = await r.json();
      return url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate download link');
      throw err;
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
    opts: {
      projectId?: string;
      description?: string;
      tags?: string[];
      organismId?: string;
      collectionId?: string;
      kind?: string;
    },
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
      const initRes = await apiFetch('/api/uploads/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          projectId: opts.projectId,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          description: opts.description,
          tags: opts.tags,
          organismId: opts.organismId,
          collectionId: opts.collectionId,
          kind: opts.kind,
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
        const partRes = await apiFetch('/api/uploads/part-url', {
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
      await apiFetch('/api/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, uploadId, s3Key, parts }),
      });

      updateUpload(tmpId, { status: 'done', loaded: file.size });
      toast.success(`Upload complete: ${file.name}`);
    } catch (err: unknown) {
      updateUpload(tmpId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      });
      toast.error(`Upload failed: ${file.name}`);
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
