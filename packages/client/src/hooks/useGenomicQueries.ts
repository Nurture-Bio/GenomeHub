import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { useApiQuery, useApiMutation } from './useApi';

// ─── Types ────────────────────────────────────────────────

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
  types:           string[];
  metadata:        Record<string, unknown> | null;
  techniques:      { id: string; name: string }[];
  organisms:       { id: string; displayName: string }[];
  createdBy:       string | null;
  fileCount:       number;
  createdAt:       string;
}

export interface GenomicFile {
  id:              string;
  filename:        string;
  s3Key:           string;
  sizeBytes:       number;
  format:          string;
  types:           string[];
  md5:             string | null;
  status:          'pending' | 'ready' | 'error';
  uploadedAt:      string;
  description:     string | null;
  tags:            string[];
  organisms:       { id: string; displayName: string }[];
  collections:     { id: string; name: string | null }[];
  uploadedBy:      string | null;
}

export interface FileDetail {
  id:              string;
  filename:        string;
  s3Key:           string;
  sizeBytes:       number;
  format:          string;
  types:           string[];
  md5:             string | null;
  status:          'pending' | 'ready' | 'error';
  description:     string | null;
  tags:            string[];
  uploadedBy:      string | null;
  uploadedAt:      string;
  collections:     { id: string; name: string; types: string[] }[];
  organisms:       { id: string; displayName: string }[];
  provenance: {
    upstream:   ProvenanceEdge[];
    downstream: ProvenanceEdge[];
  };
  links: ExternalLink[];
}

export interface ProvenanceEdge {
  edgeId:   string;
  relation: string;
  file:     { id: string; filename: string; types: string[]; format: string } | null;
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

export interface RelationType {
  id:          string;
  name:        string;
  description: string | null;
  createdAt:   string;
}

export interface FileType {
  id:          string;
  name:        string;
  description: string | null;
  createdAt:   string;
}

export type LinkParentType = 'collection' | 'file';
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

export interface CollectionFile {
  id:        string;
  filename:  string;
  types:     string[];
  format:    string;
  sizeBytes: number;
  status:    string;
}

export interface CollectionDetail {
  id:              string;
  name:            string;
  description:     string | null;
  types:           string[];
  metadata:        Record<string, unknown> | null;
  techniques:      { id: string; name: string }[];
  organisms:       { id: string; displayName: string }[];
  createdBy:       string | null;
  fileCount:       number;
  links:           ExternalLink[];
  files:           CollectionFile[];
}

// ─── Files ────────────────────────────────────────────────

export function useFilesQuery(filters?: { collectionId?: string; type?: string }) {
  const params = new URLSearchParams();
  if (filters?.collectionId) params.set('collectionId', filters.collectionId);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return useApiQuery<GenomicFile[]>(`/api/files${qs ? '?' + qs : ''}`, [filters?.collectionId, filters?.type]);
}

export function useFileDetailQuery(fileId?: string) {
  return useApiQuery<FileDetail>(fileId ? `/api/files/${fileId}` : null, [fileId]);
}

export function useDeleteFileMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string]>(
    (fileId) => ({ url: `/api/files/${fileId}`, init: { method: 'DELETE' } }),
    { successMessage: 'File deleted', errorMessage: 'Failed to delete file', onSuccess },
  );
  return { deleteFile: mutate, pending };
}

export function useUpdateFileMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string, {
    types?: string[]; format?: string;
    description?: string | null; tags?: string[];
  }], GenomicFile>(
    (fileId, body) => ({
      url: `/api/files/${fileId}`,
      init: { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    }),
    { errorMessage: 'Failed to update file', onSuccess },
  );
  return { updateFile: mutate, pending };
}

// ─── Organisms ────────────────────────────────────────────

export function useOrganismsQuery() {
  return useApiQuery<Organism[]>('/api/organisms');
}

export function useCreateOrganismMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[{
    genus: string; species: string; strain?: string;
    commonName?: string; ncbiTaxId?: number; referenceGenome?: string;
  }], Organism>(
    (body) => ({
      url: '/api/organisms',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    }),
    { successMessage: 'Organism created', errorMessage: 'Failed to create organism', onSuccess },
  );
  return { createOrganism: mutate, pending };
}

// ─── Collections ──────────────────────────────────────────

export function useCollectionsQuery(filters?: { organismId?: string; type?: string }) {
  const params = new URLSearchParams();
  if (filters?.organismId) params.set('organismId', filters.organismId);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  return useApiQuery<Collection[]>(`/api/collections${qs ? '?' + qs : ''}`, [filters?.organismId, filters?.type]);
}

export function useCollectionDetailQuery(collectionId?: string) {
  return useApiQuery<CollectionDetail>(collectionId ? `/api/collections/${collectionId}` : null, [collectionId]);
}

export function useCreateCollectionMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[{
    name: string; types?: string[];
    metadata?: Record<string, unknown>;
    description?: string;
    techniqueIds?: string[]; organismIds?: string[];
  }], Collection>(
    (body) => ({
      url: '/api/collections',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    }),
    { successMessage: 'Collection created', errorMessage: 'Failed to create collection', onSuccess },
  );
  return { createCollection: mutate, pending };
}

export function useUpdateCollectionMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string, {
    name?: string; description?: string; types?: string[];
  }]>(
    (id, body) => ({
      url: `/api/collections/${id}`,
      init: { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    }),
    { errorMessage: 'Failed to update collection', onSuccess },
  );
  return { updateCollection: mutate, pending };
}

export function useDeleteCollectionMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string]>(
    (id) => ({ url: `/api/collections/${id}`, init: { method: 'DELETE' } }),
    { successMessage: 'Collection deleted', errorMessage: 'Failed to delete collection', onSuccess },
  );
  return { deleteCollection: mutate, pending };
}

// ─── Techniques ──────────────────────────────────────────

export function useTechniquesQuery() {
  return useApiQuery<Technique[]>('/api/techniques');
}

export function useCreateTechniqueMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[{
    name: string; description?: string; defaultTags?: string[];
  }], Technique>(
    (body) => ({
      url: '/api/techniques',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    }),
    { successMessage: 'Technique created', errorMessage: 'Failed to create technique', onSuccess },
  );
  return { createTechnique: mutate, pending };
}

// ─── File types ──────────────────────────────────────────

export function useFileTypesQuery() {
  return useApiQuery<FileType[]>('/api/file-types');
}

export function useCreateFileTypeMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[{
    name: string; description?: string;
  }], FileType>(
    (body) => ({
      url: '/api/file-types',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    }),
    { successMessage: 'File type created', errorMessage: 'Failed to create file type', onSuccess },
  );
  return { createFileType: mutate, pending };
}

// ─── Relation types ──────────────────────────────────────

export function useRelationTypesQuery() {
  return useApiQuery<RelationType[]>('/api/relation-types');
}

export function useCreateRelationTypeMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[{
    name: string; description?: string;
  }], RelationType>(
    (body) => ({
      url: '/api/relation-types',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    }),
    { successMessage: 'Relation type created', errorMessage: 'Failed to create relation type', onSuccess },
  );
  return { createRelationType: mutate, pending };
}

// ─── External links ──────────────────────────────────────

export function useLinksQuery(parentType?: LinkParentType, parentId?: string) {
  const url = parentType && parentId
    ? `/api/links?parentType=${parentType}&parentId=${parentId}`
    : null;
  const result = useApiQuery<ExternalLink[]>(url, [parentType, parentId]);
  // When skipping, return empty array instead of null for backward compat
  return { ...result, data: result.data ?? (url ? null : []) };
}

export function useCreateLinkMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[{
    parentType: LinkParentType; parentId: string;
    url: string; label?: string;
  }]>(
    (body) => ({
      url: '/api/links',
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    }),
    { successMessage: 'Link added', errorMessage: 'Failed to add link', onSuccess },
  );
  return { createLink: mutate, pending };
}

export function useDeleteLinkMutation(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string]>(
    (linkId) => ({ url: `/api/links/${linkId}`, init: { method: 'DELETE' } }),
    { successMessage: 'Link removed', errorMessage: 'Failed to remove link', onSuccess },
  );
  return { deleteLink: mutate, pending };
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

// ─── File organism link/unlink ─────────────────────────────

export function useAddFileOrganism(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string, string]>(
    (fileId, organismId) => ({
      url: `/api/files/${fileId}/organisms`,
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organismId }) },
    }),
    { errorMessage: 'Failed to add organism', onSuccess },
  );
  return { addFileOrganism: mutate, pending };
}

export function useRemoveFileOrganism(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string, string]>(
    (fileId, organismId) => ({
      url: `/api/files/${fileId}/organisms/${organismId}`,
      init: { method: 'DELETE' },
    }),
    { errorMessage: 'Failed to remove organism', onSuccess },
  );
  return { removeFileOrganism: mutate, pending };
}

// ─── Collection organism link/unlink ───────────────────────

export function useAddCollectionOrganism(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string, string]>(
    (collectionId, organismId) => ({
      url: `/api/collections/${collectionId}/organisms`,
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organismId }) },
    }),
    { errorMessage: 'Failed to add organism', onSuccess },
  );
  return { addCollectionOrganism: mutate, pending };
}

export function useRemoveCollectionOrganism(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string, string]>(
    (collectionId, organismId) => ({
      url: `/api/collections/${collectionId}/organisms/${organismId}`,
      init: { method: 'DELETE' },
    }),
    { errorMessage: 'Failed to remove organism', onSuccess },
  );
  return { removeCollectionOrganism: mutate, pending };
}

// ─── Collection technique link/unlink ──────────────────────

export function useAddCollectionTechnique(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string, string]>(
    (collectionId, techniqueId) => ({
      url: `/api/collections/${collectionId}/techniques`,
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ techniqueId }) },
    }),
    { errorMessage: 'Failed to add technique', onSuccess },
  );
  return { addCollectionTechnique: mutate, pending };
}

export function useRemoveCollectionTechnique(onSuccess?: () => void) {
  const { mutate, pending } = useApiMutation<[string, string]>(
    (collectionId, techniqueId) => ({
      url: `/api/collections/${collectionId}/techniques/${techniqueId}`,
      init: { method: 'DELETE' },
    }),
    { errorMessage: 'Failed to remove technique', onSuccess },
  );
  return { removeCollectionTechnique: mutate, pending };
}

// ─── Provenance ───────────────────────────────────────────

export function useAddProvenance() {
  const { mutate, pending } = useApiMutation<[string, string, string]>(
    (fileId, targetFileId, relation) => ({
      url: `/api/files/${fileId}/provenance`,
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetFileId, relation }) },
    }),
    { successMessage: 'Provenance link added', errorMessage: 'Failed to add provenance' },
  );
  return { addProvenance: mutate, pending };
}

export function useRemoveProvenance() {
  const { mutate, pending } = useApiMutation<[string, string]>(
    (fileId, edgeId) => ({
      url: `/api/files/${fileId}/provenance/${edgeId}`,
      init: { method: 'DELETE' },
    }),
    { successMessage: 'Provenance link removed', errorMessage: 'Failed to remove provenance' },
  );
  return { removeProvenance: mutate, pending };
}

// ─── File preview ────────────────────────────────────────

export interface FilePreviewResult {
  lines:       string[];
  truncated:   boolean;
  previewable: boolean;
  format:      string;
  error?:      string;
}

export function useFilePreview(fileId: string | undefined) {
  return useApiQuery<FilePreviewResult>(
    fileId ? `/api/files/${fileId}/preview` : null,
    [fileId],
  );
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

import { useAppStore, type UploadProgress } from '../stores/useAppStore';
export type { UploadProgress };

export function useMultipartUpload() {
  const uploads = useAppStore(s => s.uploads);
  const setUpload = useAppStore(s => s.setUpload);
  const updateUploadStore = useAppStore(s => s.updateUpload);
  const clearDone = useAppStore(s => s.clearDoneUploads);

  const upload = useCallback(async (
    file:      File,
    opts: {
      description?: string;
      tags?: string[];
      organismIds?: string[];
      collectionId?: string;
      types?: string[];
    },
  ) => {
    const tmpId = crypto.randomUUID();

    setUpload(tmpId, {
      fileId: tmpId, filename: file.name,
      loaded: 0, total: file.size, status: 'uploading',
    });

    try {
      // 1. Initiate multipart upload
      const initRes = await apiFetch('/api/uploads/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          description: opts.description,
          tags: opts.tags,
          organismIds: opts.organismIds,
          collectionId: opts.collectionId,
          types: opts.types,
        }),
      });
      const { fileId, uploadId, s3Key } = await initRes.json();
      updateUploadStore(tmpId, { fileId });

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
        updateUploadStore(tmpId, { loaded: end });
      }

      // 3. Complete
      await apiFetch('/api/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, uploadId, s3Key, parts }),
      });

      updateUploadStore(tmpId, { status: 'done', loaded: file.size });
      toast.success(`Upload complete: ${file.name}`);
    } catch (err: unknown) {
      updateUploadStore(tmpId, {
        status: 'error',
        error: err instanceof Error ? err.message : 'Upload failed',
      });
      toast.error(`Upload failed: ${file.name}`);
    }
  }, [setUpload, updateUploadStore]);

  return { uploads, upload, clearDone };
}
