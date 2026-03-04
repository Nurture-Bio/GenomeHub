import { useState, useCallback } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '../lib/api';
import { queryKeys } from '../lib/queryKeys';
import { fetchApi, mutateApi } from '../lib/queryFn';
import type { DataProfile } from '@genome-hub/shared';

// ─── Types ────────────────────────────────────────────────

export interface Organism {
  id: string;
  genus: string;
  species: string;
  strain: string | null;
  commonName: string | null;
  ncbiTaxId: number | null;
  referenceGenome: string | null;
  displayName: string;
  fileCount: number;
  collectionCount: number;
  createdAt: string;
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  types: string[];
  metadata: Record<string, unknown> | null;
  techniques: { id: string; name: string }[];
  organisms: { id: string; displayName: string }[];
  createdBy: string | null;
  fileCount: number;
  createdAt: string;
}

export interface GenomicFile {
  id: string;
  filename: string;
  s3Key: string;
  sizeBytes: number;
  format: string;
  types: string[];
  md5: string | null;
  status: 'pending' | 'ready' | 'error';
  uploadedAt: string;
  description: string | null;
  tags: string[];
  organisms: { id: string; displayName: string }[];
  collections: { id: string; name: string | null }[];
  uploadedBy: string | null;
  dataProfile: DataProfile | null;
}

export interface FileDetail {
  id: string;
  filename: string;
  s3Key: string;
  sizeBytes: number;
  format: string;
  types: string[];
  md5: string | null;
  status: 'pending' | 'ready' | 'error';
  description: string | null;
  tags: string[];
  uploadedBy: string | null;
  uploadedAt: string;
  collections: { id: string; name: string; types: string[] }[];
  organisms: { id: string; displayName: string }[];
  provenance: {
    upstream: ProvenanceEdge[];
    downstream: ProvenanceEdge[];
  };
  links: ExternalLink[];
}

export interface ProvenanceEdge {
  edgeId: string;
  relation: string;
  file: { id: string; filename: string; types: string[]; format: string } | null;
}

export interface StorageStats {
  totalFiles: number;
  totalBytes: number;
  byFormat: { format: string; count: number; bytes: number }[];
}

export interface Technique {
  id: string;
  name: string;
  description: string | null;
  defaultTags: string[];
  createdAt: string;
}

export interface RelationType {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export interface FileType {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
}

export type LinkParentType = 'collection' | 'file';
export type LinkServiceType =
  | 'jira'
  | 'confluence'
  | 'slack'
  | 'google-doc'
  | 'google-sheet'
  | 'google-drive'
  | 'github'
  | 'notion'
  | 'benchling'
  | 'ncbi'
  | 'ebi'
  | 'protocols-io'
  | 'link';

export interface ExternalLink {
  id: string;
  parentType: LinkParentType;
  parentId: string;
  url: string;
  service: LinkServiceType;
  label: string | null;
  createdAt: string;
}

export interface CollectionFile {
  id: string;
  filename: string;
  types: string[];
  format: string;
  sizeBytes: number;
  status: string;
}

export interface CollectionDetail {
  id: string;
  name: string;
  description: string | null;
  types: string[];
  metadata: Record<string, unknown> | null;
  techniques: { id: string; name: string }[];
  organisms: { id: string; displayName: string }[];
  createdBy: string | null;
  fileCount: number;
  links: ExternalLink[];
  files: CollectionFile[];
}

// ─── Files ────────────────────────────────────────────────

export function useFilesQuery(filters?: { collectionId?: string; type?: string } | false) {
  const enabled = filters !== false;
  const params = new URLSearchParams();
  if (enabled && filters?.collectionId) params.set('collectionId', filters.collectionId);
  if (enabled && filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  const url = `/api/files${qs ? '?' + qs : ''}`;

  return useQuery({
    queryKey: queryKeys.files.list(enabled ? filters : undefined),
    queryFn: async () => {
      const files = await fetchApi<GenomicFile[]>(url);
      // Prime Zustand store — every file with a dataProfile is warm before any click
      const { setFileProfile, getValidFileProfile } = useAppStore.getState();
      for (const f of files) {
        if (f.dataProfile && !getValidFileProfile(f.id)) {
          setFileProfile(f.id, {
            dataProfile: f.dataProfile,
            parquetUrl: '', // populated on first parquet-url fetch
            cachedAt: Date.now(),
          });
        }
      }
      return files;
    },
    enabled,
  });
}

export function useFileDetailQuery(fileId?: string) {
  return useQuery({
    queryKey: queryKeys.files.detail(fileId!),
    queryFn: () => fetchApi<FileDetail>(`/api/files/${fileId}`),
    enabled: !!fileId,
  });
}

export function useDeleteFileMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (fileId: string) => mutateApi(`/api/files/${fileId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.files.all });
      qc.invalidateQueries({ queryKey: queryKeys.collections.all });
      qc.invalidateQueries({ queryKey: queryKeys.stats.storage });
      toast.success('File deleted');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete file'),
  });
  return { deleteFile: mutation.mutateAsync, pending: mutation.isPending };
}

export function useUpdateFileMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      fileId,
      body,
    }: {
      fileId: string;
      body: { types?: string[]; format?: string; description?: string | null; tags?: string[] };
    }) =>
      mutateApi<GenomicFile>(`/api/files/${fileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, { fileId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.files.all });
      qc.invalidateQueries({ queryKey: queryKeys.files.detail(fileId) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to update file'),
  });
  const updateFile = useCallback(
    (
      fileId: string,
      body: { types?: string[]; format?: string; description?: string | null; tags?: string[] },
    ) => mutation.mutateAsync({ fileId, body }),
    [mutation],
  );
  return { updateFile, pending: mutation.isPending };
}

// ─── Organisms ────────────────────────────────────────────

export function useOrganismsQuery() {
  return useQuery({
    queryKey: queryKeys.organisms.list(),
    queryFn: () => fetchApi<Organism[]>('/api/organisms'),
    staleTime: 60_000,
  });
}

export function useCreateOrganismMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: {
      genus: string;
      species: string;
      strain?: string;
      commonName?: string;
      ncbiTaxId?: number;
      referenceGenome?: string;
    }) =>
      mutateApi<Organism>('/api/organisms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      qc.setQueryData(queryKeys.organisms.list(), (old: Organism[] | undefined) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: queryKeys.organisms.all });
      toast.success('Organism created');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to create organism'),
  });
  return { createOrganism: mutation.mutateAsync, pending: mutation.isPending };
}

export function useUpdateOrganismMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      mutateApi(`/api/organisms/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.organisms.all });
    },
    onError: () => toast.error('Failed to update organism'),
  });
  return { updateOrganism: mutation.mutateAsync, pending: mutation.isPending };
}

export function useDeleteOrganismMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => mutateApi(`/api/organisms/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.organisms.all });
      toast.success('Deleted');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to delete organism'),
  });
  return { deleteOrganism: mutation.mutateAsync, pending: mutation.isPending };
}

// ─── Collections ──────────────────────────────────────────

export function useCollectionsQuery(filters?: { organismId?: string; type?: string }) {
  const params = new URLSearchParams();
  if (filters?.organismId) params.set('organismId', filters.organismId);
  if (filters?.type) params.set('type', filters.type);
  const qs = params.toString();
  const url = `/api/collections${qs ? '?' + qs : ''}`;

  return useQuery({
    queryKey: queryKeys.collections.list(filters),
    queryFn: () => fetchApi<Collection[]>(url),
  });
}

export function useCollectionDetailQuery(collectionId?: string) {
  return useQuery({
    queryKey: queryKeys.collections.detail(collectionId!),
    queryFn: () => fetchApi<CollectionDetail>(`/api/collections/${collectionId}`),
    enabled: !!collectionId,
  });
}

export function useCreateCollectionMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: {
      name: string;
      types?: string[];
      metadata?: Record<string, unknown>;
      description?: string;
      techniqueIds?: string[];
      organismIds?: string[];
    }) =>
      mutateApi<Collection>('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      // Seed cache so pickers see the new entity immediately
      qc.setQueryData(queryKeys.collections.list({}), (old: Collection[] | undefined) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: queryKeys.collections.all });
      qc.invalidateQueries({ queryKey: queryKeys.stats.storage });
      toast.success('Collection created');
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to create collection'),
  });
  return { createCollection: mutation.mutateAsync, pending: mutation.isPending };
}

export function useUpdateCollectionMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { name?: string; description?: string; types?: string[] };
    }) =>
      mutateApi(`/api/collections/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.collections.all });
      qc.invalidateQueries({ queryKey: queryKeys.collections.detail(id) });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to update collection'),
  });
  const updateCollection = useCallback(
    (id: string, body: { name?: string; description?: string; types?: string[] }) =>
      mutation.mutateAsync({ id, body }),
    [mutation],
  );
  return { updateCollection, pending: mutation.isPending };
}

export function useDeleteCollectionMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => mutateApi(`/api/collections/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.collections.all });
      qc.invalidateQueries({ queryKey: queryKeys.stats.storage });
      toast.success('Collection deleted');
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to delete collection'),
  });
  return { deleteCollection: mutation.mutateAsync, pending: mutation.isPending };
}

// ─── Techniques ──────────────────────────────────────────

export function useTechniquesQuery() {
  return useQuery({
    queryKey: queryKeys.techniques.all,
    queryFn: () => fetchApi<Technique[]>('/api/techniques'),
    staleTime: 120_000,
  });
}

export function useCreateTechniqueMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: { name: string; description?: string; defaultTags?: string[] }) =>
      mutateApi<Technique>('/api/techniques', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      qc.setQueryData(queryKeys.techniques.all, (old: Technique[] | undefined) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: queryKeys.techniques.all });
      toast.success('Technique created');
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to create technique'),
  });
  return { createTechnique: mutation.mutateAsync, pending: mutation.isPending };
}

export function useUpdateTechniqueMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; description?: string } }) =>
      mutateApi(`/api/techniques/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.techniques.all });
      toast.success('Updated');
    },
    onError: () => toast.error('Update failed'),
  });
  return { updateTechnique: mutation.mutateAsync, pending: mutation.isPending };
}

export function useDeleteTechniqueMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => mutateApi(`/api/techniques/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.techniques.all });
      toast.success('Deleted');
    },
    onError: () => toast.error('Delete failed'),
  });
  return { deleteTechnique: mutation.mutateAsync, pending: mutation.isPending };
}

// ─── File types ──────────────────────────────────────────

export function useFileTypesQuery() {
  return useQuery({
    queryKey: queryKeys.fileTypes.all,
    queryFn: () => fetchApi<FileType[]>('/api/file-types'),
    staleTime: 120_000,
  });
}

export function useCreateFileTypeMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      mutateApi<FileType>('/api/file-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      qc.setQueryData(queryKeys.fileTypes.all, (old: FileType[] | undefined) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: queryKeys.fileTypes.all });
      toast.success('File type created');
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to create file type'),
  });
  return { createFileType: mutation.mutateAsync, pending: mutation.isPending };
}

export function useUpdateFileTypeMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; description?: string } }) =>
      mutateApi(`/api/file-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fileTypes.all });
      toast.success('Updated');
    },
    onError: () => toast.error('Update failed'),
  });
  return { updateFileType: mutation.mutateAsync, pending: mutation.isPending };
}

export function useDeleteFileTypeMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => mutateApi(`/api/file-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.fileTypes.all });
      toast.success('Deleted');
    },
    onError: () => toast.error('Delete failed'),
  });
  return { deleteFileType: mutation.mutateAsync, pending: mutation.isPending };
}

// ─── Relation types ──────────────────────────────────────

export function useRelationTypesQuery() {
  return useQuery({
    queryKey: queryKeys.relationTypes.all,
    queryFn: () => fetchApi<RelationType[]>('/api/relation-types'),
    staleTime: 120_000,
  });
}

export function useCreateRelationTypeMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      mutateApi<RelationType>('/api/relation-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (created) => {
      qc.setQueryData(queryKeys.relationTypes.all, (old: RelationType[] | undefined) =>
        old ? [created, ...old] : [created],
      );
      qc.invalidateQueries({ queryKey: queryKeys.relationTypes.all });
      toast.success('Relation type created');
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to create relation type'),
  });
  return { createRelationType: mutation.mutateAsync, pending: mutation.isPending };
}

export function useUpdateRelationTypeMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; description?: string } }) =>
      mutateApi(`/api/relation-types/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.relationTypes.all });
      toast.success('Updated');
    },
    onError: () => toast.error('Update failed'),
  });
  return { updateRelationType: mutation.mutateAsync, pending: mutation.isPending };
}

export function useDeleteRelationTypeMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => mutateApi(`/api/relation-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.relationTypes.all });
      toast.success('Deleted');
    },
    onError: () => toast.error('Delete failed'),
  });
  return { deleteRelationType: mutation.mutateAsync, pending: mutation.isPending };
}

// ─── External links ──────────────────────────────────────

export function useLinksQuery(parentType?: LinkParentType, parentId?: string) {
  const enabled = !!parentType && !!parentId;
  const result = useQuery({
    queryKey: queryKeys.links.list(parentType!, parentId!),
    queryFn: () =>
      fetchApi<ExternalLink[]>(`/api/links?parentType=${parentType}&parentId=${parentId}`),
    enabled,
  });
  return { ...result, data: result.data ?? (enabled ? undefined : []) };
}

export function useCreateLinkMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: {
      parentType: LinkParentType;
      parentId: string;
      url: string;
      label?: string;
    }) =>
      mutateApi('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({
        queryKey: queryKeys.links.list(variables.parentType, variables.parentId),
      });
      toast.success('Link added');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to add link'),
  });
  return { createLink: mutation.mutateAsync, pending: mutation.isPending };
}

export function useDeleteLinkMutation(parentType?: LinkParentType, parentId?: string) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (linkId: string) => mutateApi(`/api/links/${linkId}`, { method: 'DELETE' }),
    onSuccess: () => {
      if (parentType && parentId) {
        qc.invalidateQueries({ queryKey: queryKeys.links.list(parentType, parentId) });
      }
      toast.success('Link removed');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to remove link'),
  });
  return { deleteLink: mutation.mutateAsync, pending: mutation.isPending };
}

// ─── Storage stats ────────────────────────────────────────

export function useStorageStats() {
  return useQuery({
    queryKey: queryKeys.stats.storage,
    queryFn: () => fetchApi<StorageStats>('/api/stats'),
  });
}

// ─── Collection membership ────────────────────────────────

export function useAddFilesToCollection() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ collectionId, fileIds }: { collectionId: string; fileIds: string[] }) =>
      mutateApi(`/api/collections/${collectionId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds }),
      }),
    onSuccess: (_data, { collectionId, fileIds }) => {
      qc.invalidateQueries({ queryKey: queryKeys.collections.detail(collectionId) });
      qc.invalidateQueries({ queryKey: queryKeys.collections.all });
      qc.invalidateQueries({ queryKey: queryKeys.files.all });
      toast.success(`Added ${fileIds.length} file${fileIds.length !== 1 ? 's' : ''} to collection`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to add files'),
  });
  const addFiles = useCallback(
    (collectionId: string, fileIds: string[]) => mutation.mutateAsync({ collectionId, fileIds }),
    [mutation],
  );
  return { addFiles, pending: mutation.isPending };
}

export function useRemoveFilesFromCollection() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ collectionId, fileIds }: { collectionId: string; fileIds: string[] }) =>
      mutateApi(`/api/collections/${collectionId}/files`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds }),
      }),
    onSuccess: (_data, { collectionId, fileIds }) => {
      qc.invalidateQueries({ queryKey: queryKeys.collections.detail(collectionId) });
      qc.invalidateQueries({ queryKey: queryKeys.collections.all });
      qc.invalidateQueries({ queryKey: queryKeys.files.all });
      toast.success(
        `Removed ${fileIds.length} file${fileIds.length !== 1 ? 's' : ''} from collection`,
      );
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to remove files'),
  });
  const removeFiles = useCallback(
    (collectionId: string, fileIds: string[]) => mutation.mutateAsync({ collectionId, fileIds }),
    [mutation],
  );
  return { removeFiles, pending: mutation.isPending };
}

// ─── File organism link/unlink ─────────────────────────────

export function useAddFileOrganism() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ fileId, organismId }: { fileId: string; organismId: string }) =>
      mutateApi(`/api/files/${fileId}/organisms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organismId }),
      }),
    onSuccess: (_data, { fileId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.files.all });
      qc.invalidateQueries({ queryKey: queryKeys.files.detail(fileId) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to add organism'),
  });
  const addFileOrganism = useCallback(
    (fileId: string, organismId: string) => mutation.mutateAsync({ fileId, organismId }),
    [mutation],
  );
  return { addFileOrganism, pending: mutation.isPending };
}

export function useRemoveFileOrganism() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ fileId, organismId }: { fileId: string; organismId: string }) =>
      mutateApi(`/api/files/${fileId}/organisms/${organismId}`, { method: 'DELETE' }),
    onSuccess: (_data, { fileId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.files.all });
      qc.invalidateQueries({ queryKey: queryKeys.files.detail(fileId) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to remove organism'),
  });
  const removeFileOrganism = useCallback(
    (fileId: string, organismId: string) => mutation.mutateAsync({ fileId, organismId }),
    [mutation],
  );
  return { removeFileOrganism, pending: mutation.isPending };
}

// ─── Collection organism link/unlink ───────────────────────

export function useAddCollectionOrganism() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ collectionId, organismId }: { collectionId: string; organismId: string }) =>
      mutateApi(`/api/collections/${collectionId}/organisms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organismId }),
      }),
    onSuccess: (_data, { collectionId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.collections.detail(collectionId) });
      qc.invalidateQueries({ queryKey: queryKeys.collections.all });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to add organism'),
  });
  const addCollectionOrganism = useCallback(
    (collectionId: string, organismId: string) =>
      mutation.mutateAsync({ collectionId, organismId }),
    [mutation],
  );
  return { addCollectionOrganism, pending: mutation.isPending };
}

export function useRemoveCollectionOrganism() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ collectionId, organismId }: { collectionId: string; organismId: string }) =>
      mutateApi(`/api/collections/${collectionId}/organisms/${organismId}`, { method: 'DELETE' }),
    onSuccess: (_data, { collectionId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.collections.detail(collectionId) });
      qc.invalidateQueries({ queryKey: queryKeys.collections.all });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to remove organism'),
  });
  const removeCollectionOrganism = useCallback(
    (collectionId: string, organismId: string) =>
      mutation.mutateAsync({ collectionId, organismId }),
    [mutation],
  );
  return { removeCollectionOrganism, pending: mutation.isPending };
}

// ─── Collection technique link/unlink ──────────────────────

export function useAddCollectionTechnique() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ collectionId, techniqueId }: { collectionId: string; techniqueId: string }) =>
      mutateApi(`/api/collections/${collectionId}/techniques`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ techniqueId }),
      }),
    onSuccess: (_data, { collectionId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.collections.detail(collectionId) });
      qc.invalidateQueries({ queryKey: queryKeys.collections.all });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to add technique'),
  });
  const addCollectionTechnique = useCallback(
    (collectionId: string, techniqueId: string) =>
      mutation.mutateAsync({ collectionId, techniqueId }),
    [mutation],
  );
  return { addCollectionTechnique, pending: mutation.isPending };
}

export function useRemoveCollectionTechnique() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ collectionId, techniqueId }: { collectionId: string; techniqueId: string }) =>
      mutateApi(`/api/collections/${collectionId}/techniques/${techniqueId}`, { method: 'DELETE' }),
    onSuccess: (_data, { collectionId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.collections.detail(collectionId) });
      qc.invalidateQueries({ queryKey: queryKeys.collections.all });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to remove technique'),
  });
  const removeCollectionTechnique = useCallback(
    (collectionId: string, techniqueId: string) =>
      mutation.mutateAsync({ collectionId, techniqueId }),
    [mutation],
  );
  return { removeCollectionTechnique, pending: mutation.isPending };
}

// ─── Provenance ───────────────────────────────────────────

export function useAddProvenance() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      fileId,
      targetFileId,
      relation,
    }: {
      fileId: string;
      targetFileId: string;
      relation: string;
    }) =>
      mutateApi(`/api/files/${fileId}/provenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetFileId, relation }),
      }),
    onSuccess: (_data, { fileId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.files.detail(fileId) });
      toast.success('Provenance link added');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to add provenance'),
  });
  const addProvenance = useCallback(
    (fileId: string, targetFileId: string, relation: string) =>
      mutation.mutateAsync({ fileId, targetFileId, relation }),
    [mutation],
  );
  return { addProvenance, pending: mutation.isPending };
}

export function useRemoveProvenance() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ fileId, edgeId }: { fileId: string; edgeId: string }) =>
      mutateApi(`/api/files/${fileId}/provenance/${edgeId}`, { method: 'DELETE' }),
    onSuccess: (_data, { fileId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.files.detail(fileId) });
      toast.success('Provenance link removed');
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to remove provenance'),
  });
  const removeProvenance = useCallback(
    (fileId: string, edgeId: string) => mutation.mutateAsync({ fileId, edgeId }),
    [mutation],
  );
  return { removeProvenance, pending: mutation.isPending };
}

// ─── File preview ────────────────────────────────────────

export interface FilePreviewPage {
  lines: string[];
  truncated: boolean;
  previewable: boolean;
  format: string;
  nextStartByte: number | null;
  error?: string;
}

export function useInfiniteFilePreview(fileId: string | undefined) {
  return useInfiniteQuery({
    queryKey: queryKeys.files.preview(fileId!),
    queryFn: ({ pageParam }) =>
      fetchApi<FilePreviewPage>(`/api/files/${fileId}/preview?startByte=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextStartByte ?? undefined,
    enabled: !!fileId,
    staleTime: Infinity,
  });
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
  const uploads = useAppStore((s) => s.uploads);
  const setUpload = useAppStore((s) => s.setUpload);
  const updateUploadStore = useAppStore((s) => s.updateUpload);
  const clearDone = useAppStore((s) => s.clearDoneUploads);
  const qc = useQueryClient();

  const upload = useCallback(
    async (
      file: File,
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
        fileId: tmpId,
        filename: file.name,
        loaded: 0,
        total: file.size,
        status: 'uploading',
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
        const partCount = Math.ceil(file.size / PART_SIZE);
        const parts: { PartNumber: number; ETag: string }[] = [];

        for (let i = 0; i < partCount; i++) {
          const start = i * PART_SIZE;
          const end = Math.min(start + PART_SIZE, file.size);
          const chunk = file.slice(start, end);

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

        // Visual completion: let the RiverGauge settle before transitioning
        updateUploadStore(tmpId, { loaded: file.size });
        await new Promise((r) => setTimeout(r, 1000));
        updateUploadStore(tmpId, { status: 'done' });
        toast.success(`Upload complete: ${file.name}`);

        // Invalidate relevant queries
        qc.invalidateQueries({ queryKey: queryKeys.files.all });
        qc.invalidateQueries({ queryKey: queryKeys.stats.storage });
      } catch (err: unknown) {
        updateUploadStore(tmpId, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Upload failed',
        });
        toast.error(`Upload failed: ${file.name}`);
      }
    },
    [setUpload, updateUploadStore, qc],
  );

  return { uploads, upload, clearDone };
}

// ─── Engines ──────────────────────────────────────────────

export interface EngineStatus {
  id: string;
  name: string;
  url: string;
  status: 'ok' | 'error' | 'unavailable';
  createdAt: string;
}

export interface EngineMethodOption {
  value: string;
  label: string;
  description?: string;
  parameters?: Record<string, string | number | boolean>;
}

export interface EngineMethodParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
  default?: string;
  accept?: string[];
  options?: EngineMethodOption[];
}

export interface EngineMethodStep {
  key: string;
  label: string;
}

export interface EngineMethod {
  id: string;
  name: string;
  description: string;
  async?: boolean;
  steps?: EngineMethodStep[];
  parameters: EngineMethodParam[];
  returns: { type: string; description: string };
}

export interface EngineJobStatus {
  status: 'queued' | 'running' | 'saving' | 'complete' | 'failed';
  progress: {
    pct_complete: number | null;
    rate_per_sec: number | null;
    eta_seconds: number | null;
  };
  step: string | null;
  stage: string | null;
  items: { complete: number; total: number } | null;
  error: string | null;
  fileId?: string;
  filename?: string;
}

export function useEnginesQuery() {
  return useQuery({
    queryKey: queryKeys.engines.all,
    queryFn: () => fetchApi<EngineStatus[]>('/api/engines'),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: false,
  });
}

export function useCreateEngineMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: { name: string; url: string }) =>
      mutateApi('/api/engines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.engines.all });
      toast.success('Engine added');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to add engine'),
  });
  return { createEngine: mutation.mutateAsync, pending: mutation.isPending };
}

export function useUpdateEngineMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; url?: string } }) =>
      mutateApi(`/api/engines/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.engines.all });
      toast.success('Updated');
    },
    onError: () => toast.error('Update failed'),
  });
  return { updateEngine: mutation.mutateAsync, pending: mutation.isPending };
}

export function useDeleteEngineMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (id: string) => mutateApi(`/api/engines/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.engines.all });
      toast.success('Engine removed');
    },
    onError: () => toast.error('Delete failed'),
  });
  return { deleteEngine: mutation.mutateAsync, pending: mutation.isPending };
}

export function useEngineMethodsQuery(engineId?: string) {
  return useQuery({
    queryKey: queryKeys.engines.methods(engineId!),
    queryFn: () => fetchApi<EngineMethod[]>(`/api/engines/${engineId}/methods`),
    enabled: !!engineId,
    staleTime: 60_000,
  });
}

export function useEngineJobQuery(jobId?: string) {
  return useQuery({
    queryKey: queryKeys.engines.job(jobId!),
    queryFn: () => fetchApi<EngineJobStatus>(`/api/engines/jobs/${jobId}`),
    enabled: !!jobId,
    staleTime: 0,
    retry: true,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15000),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === 'complete' || s === 'failed') return false;
      // Back off polling when erroring, but keep trying
      return query.state.error ? 5000 : 100;
    },
  });
}

export function useRunMethodMutation() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({
      engineId,
      methodId,
      params,
    }: {
      engineId: string;
      methodId: string;
      params: Record<string, string>;
    }) =>
      mutateApi<{ fileId?: string; filename?: string; jobId?: string }>(
        `/api/engines/${engineId}/methods/${methodId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        },
      ),
    onSuccess: (result) => {
      if (result?.fileId) {
        // Sync result — already done, show immediately
        qc.invalidateQueries({ queryKey: queryKeys.files.all });
        qc.invalidateQueries({ queryKey: queryKeys.stats.storage });
        toast.success(`Result: ${result.filename ?? 'done'}`);
      }
      // Async result (jobId) — EnginePanel watches job completion
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Method failed'),
  });
  return { runMethod: mutation.mutateAsync, pending: mutation.isPending };
}

// ─── Pipeline errors ───────────────────────────────────────

export interface PipelineError {
  id: string;
  filename: string;
  sizeBytes: number;
  format: string;
  status: string;
  parquetStatus: string;
  parquetError: string | null;
  uploadedAt: string;
  updatedAt: string;
}

export function usePipelineErrors() {
  return useQuery({
    queryKey: queryKeys.files.errors(),
    queryFn: () => fetchApi<PipelineError[]>('/api/files/errors'),
  });
}
