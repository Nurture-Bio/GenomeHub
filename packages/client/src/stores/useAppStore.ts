import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface RecentSelections {
  projects: string[];
  collections: string[];
}

interface PersistedState {
  sidebarOpen: boolean;
  recentSelections: RecentSelections;
}

interface AppState extends PersistedState {
  selectedFileIds: Set<string>;
  breadcrumbLabels: Record<string, string>;

  toggleFileSelection: (id: string) => void;
  selectAllFiles: (ids: string[]) => void;
  clearSelection: () => void;
  toggleSidebar: () => void;
  addRecentSelection: (kind: keyof RecentSelections, id: string) => void;
  setBreadcrumbLabel: (id: string, label: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedFileIds: new Set<string>(),
      sidebarOpen: true,
      recentSelections: { projects: [], collections: [] },
      breadcrumbLabels: {},

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

      toggleSidebar: () =>
        set((s) => ({ sidebarOpen: !s.sidebarOpen })),

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
    }),
    {
      name: 'genomehub-app',
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedState => ({
        sidebarOpen: state.sidebarOpen,
        recentSelections: state.recentSelections,
      }),
    }
  )
);
