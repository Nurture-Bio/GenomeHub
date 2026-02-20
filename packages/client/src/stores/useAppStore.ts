import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface UploadProgress {
  fileId:   string;
  filename: string;
  loaded:   number;
  total:    number;
  status:   'uploading' | 'done' | 'error';
  error?:   string;
}

interface RecentSelections {
  collections: string[];
}

interface PersistedState {
  recentSelections: RecentSelections;
}

interface AppState extends PersistedState {
  selectedFileIds: Set<string>;
  breadcrumbLabels: Record<string, string>;
  uploads: Map<string, UploadProgress>;

  toggleFileSelection: (id: string) => void;
  selectAllFiles: (ids: string[]) => void;
  clearSelection: () => void;
  addRecentSelection: (kind: keyof RecentSelections, id: string) => void;
  setBreadcrumbLabel: (id: string, label: string) => void;
  setUpload: (id: string, progress: UploadProgress) => void;
  updateUpload: (id: string, patch: Partial<UploadProgress>) => void;
  clearDoneUploads: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedFileIds: new Set<string>(),
      recentSelections: { collections: [] },
      breadcrumbLabels: {},
      uploads: new Map<string, UploadProgress>(),

      toggleFileSelection: (id) =>
        set((s) => {
          const next = new Set(s.selectedFileIds);
          next.has(id) ? next.delete(id) : next.add(id);
          return { selectedFileIds: next };
        }),

      selectAllFiles: (ids) =>
        set({ selectedFileIds: new Set(ids) }),

      clearSelection: () =>
        set({ selectedFileIds: new Set<string>() }),

      addRecentSelection: (kind, id) =>
        set((s) => {
          const list = s.recentSelections[kind].filter((x) => x !== id);
          list.push(id);
          return {
            recentSelections: {
              ...s.recentSelections,
              [kind]: list.slice(-5),
            },
          };
        }),

      setBreadcrumbLabel: (id, label) =>
        set((s) => ({
          breadcrumbLabels: { ...s.breadcrumbLabels, [id]: label },
        })),

      setUpload: (id, progress) =>
        set((s) => {
          const next = new Map(s.uploads);
          next.set(id, progress);
          return { uploads: next };
        }),

      updateUpload: (id, patch) =>
        set((s) => {
          const next = new Map(s.uploads);
          const cur = next.get(id);
          if (cur) next.set(id, { ...cur, ...patch });
          return { uploads: next };
        }),

      clearDoneUploads: () =>
        set((s) => {
          const next = new Map(s.uploads);
          for (const [k, v] of next) {
            if (v.status === 'done') next.delete(k);
          }
          return { uploads: next };
        }),
    }),
    {
      name: 'genomehub-app',
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedState => ({
        recentSelections: state.recentSelections,
      }),
    }
  )
);
