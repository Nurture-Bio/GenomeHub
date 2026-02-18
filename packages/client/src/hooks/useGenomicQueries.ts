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
  experimentCount: number;
  createdAt:       string;
}

export interface Experiment {
  id:                  string;
  name:                string;
  description:         string | null;
  experimentTypeId:    string | null;
  experimentTypeName:  string | null;
  experimentDate:      string | null;
  createdBy:           string | null;
  projectId:           string | null;
  projectName:         string | null;
  organismId:          string | null;
  organismDisplay:     string | null;
  fileCount:           number;
  datasetCount?:       number;
  createdAt:           string;
}

export interface GenomicFile {
  id:              string;
  projectId:       string | null;
  projectName:     string | null;
  filename:        string;
  s3Key:           string;
  sizeBytes:       number;
  format:          string;
  md5:             string | null;
  status:          'pending' | 'ready' | 'error';
  uploadedAt:      string;
  description:     string | null;
  tags:            string[];
  organismId:      string | null;
  organismDisplay: string | null;
  experimentId:    string | null;
  experimentName:  string | null;
  datasetId:       string | null;
  datasetName:     string | null;
  uploadedBy:      string | null;
}

export interface StorageStats {
  totalFiles:  number;
  totalBytes:  number;
  byFormat:    { format: string; count: number; bytes: number }[];
}

export type DatasetKind = 'sample' | 'library' | 'reference' | 'pool' | 'control' | 'other';

export interface Dataset {
  id:              string;
  name:            string;
  kind:            DatasetKind;
  description:     string | null;
  condition:       string | null;
  replicate:       number | null;
  metadata:        Record<string, unknown> | null;
  tags:            string[];
  experimentId?:   string | null;
  experimentName?: string | null;
  fileCount?:      number;
  createdAt:       string;
}

export interface ExperimentType {
  id:          string;
  name:        string;
  description: string | null;
  defaultTags: string[];
  createdAt:   string;
}

export type LinkParentType = 'project' | 'experiment' | 'dataset';
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
  experiments: ProjectTreeExperiment[];
}

export interface ProjectTreeExperiment {
  id:              string;
  name:            string;
  description:     string | null;
  experimentType:  { id: string; name: string } | null;
  organismId:      string | null;
  organismDisplay: string | null;
  status:          string;
  fileCount:       number;
  links:           ExternalLink[];
  datasets:        ProjectTreeDataset[];
}

export interface ProjectTreeDataset {
  id:          string;
  name:        string;
  kind:        DatasetKind;
  description: string | null;
  condition:   string | null;
  replicate:   number | null;
  metadata:    Record<string, unknown> | null;
  tags:        string[];
  fileCount:   number;
  links:       ExternalLink[];
}

// ─── Files ────────────────────────────────────────────────

export function useFilesQuery(filters?: { projectId?: string; experimentId?: string; datasetId?: string } | string) {
  const projectId = typeof filters === 'string' ? filters : filters?.projectId;
  const experimentId = typeof filters === 'string' ? undefined : filters?.experimentId;
  const datasetId = typeof filters === 'string' ? undefined : filters?.datasetId;

  const [data, setData] = useState<GenomicFile[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (experimentId) params.set('experimentId', experimentId);
    if (datasetId) params.set('datasetId', datasetId);
    const qs = params.toString();
    apiFetch(`/api/files${qs ? '?' + qs : ''}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [projectId, experimentId, datasetId]);

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

// ─── Experiments ──────────────────────────────────────────

export function useExperimentsQuery(filters?: { projectId?: string; organismId?: string }) {
  const [data, setData] = useState<Experiment[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (filters?.projectId) params.set('projectId', filters.projectId);
    if (filters?.organismId) params.set('organismId', filters.organismId);
    const qs = params.toString();
    apiFetch(`/api/experiments${qs ? '?' + qs : ''}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [filters?.projectId, filters?.organismId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

export interface ExperimentDetail {
  id:              string;
  name:            string;
  description:     string | null;
  experimentType:  { id: string; name: string } | null;
  organismId:      string | null;
  organismDisplay: string | null;
  status:          string;
  experimentDate:  string | null;
  createdBy:       string | null;
  projectId:       string | null;
  projectName:     string | null;
  fileCount:       number;
  links:           ExternalLink[];
  datasets:        ProjectTreeDataset[];
}

export function useExperimentDetailQuery(experimentId?: string) {
  const [data, setData] = useState<ExperimentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    if (!experimentId) { setIsLoading(false); return; }
    setIsLoading(true);
    apiFetch(`/api/experiments/${experimentId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [experimentId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

export function useCreateExperimentMutation(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);

  const createExperiment = useCallback(async (body: {
    name: string; experimentTypeId: string; organismId: string;
    projectId?: string; description?: string; experimentDate?: string;
  }) => {
    setPending(true);
    try {
      const r = await apiFetch('/api/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Create failed');
      onSuccess?.();
      toast.success('Experiment created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create experiment');
      throw err;
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { createExperiment, pending };
}

// ─── Experiment types ────────────────────────────────────

export function useExperimentTypesQuery() {
  const [data, setData] = useState<ExperimentType[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    setIsLoading(true);
    apiFetch('/api/experiment-types')
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

export function useCreateExperimentTypeMutation(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);

  const createExperimentType = useCallback(async (body: {
    name: string; description?: string; defaultTags?: string[];
  }) => {
    setPending(true);
    try {
      const r = await apiFetch('/api/experiment-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Create failed');
      const data = await r.json() as ExperimentType;
      onSuccess?.();
      toast.success('Experiment type created');
      return data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create experiment type');
      throw err;
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { createExperimentType, pending };
}

// ─── Datasets ──────────────────────────────────────────────

export function useDatasetsQuery(filters?: { experimentId?: string; projectId?: string; kind?: string }) {
  const [data, setData] = useState<Dataset[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(() => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (filters?.experimentId) params.set('experimentId', filters.experimentId);
    if (filters?.projectId) params.set('projectId', filters.projectId);
    if (filters?.kind) params.set('kind', filters.kind);
    const qs = params.toString();
    apiFetch(`/api/datasets${qs ? '?' + qs : ''}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setData(d); setError(null); })
      .catch(e => setError(e))
      .finally(() => setIsLoading(false));
  }, [filters?.experimentId, filters?.projectId, filters?.kind]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, isLoading, error, refetch };
}

export function useCreateDatasetMutation(onSuccess?: () => void) {
  const [pending, setPending] = useState(false);

  const createDataset = useCallback(async (body: {
    name: string; kind?: string; experimentId?: string; projectId?: string;
    description?: string; condition?: string; replicate?: number;
    metadata?: Record<string, unknown>; tags?: string[];
  }) => {
    setPending(true);
    try {
      const r = await apiFetch('/api/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('Create failed');
      onSuccess?.();
      toast.success('Dataset created');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create dataset');
      throw err;
    } finally {
      setPending(false);
    }
  }, [onSuccess]);

  return { createDataset, pending };
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
    projectId: string,
    description?: string,
    tags?: string[],
    organismId?: string,
    experimentId?: string,
    datasetId?: string,
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
          filename: file.name, projectId,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size, description, tags,
          organismId, experimentId, datasetId,
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
