export const queryKeys = {
  files: {
    all: ['files'] as const,
    list: (filters?: { collectionId?: string; type?: string }) =>
      ['files', 'list', filters] as const,
    detail: (id: string) => ['files', 'detail', id] as const,
    preview: (id: string) => ['files', 'preview', id] as const,
  },
  collections: {
    all: ['collections'] as const,
    list: (filters?: { organismId?: string; type?: string }) =>
      ['collections', 'list', filters] as const,
    detail: (id: string) => ['collections', 'detail', id] as const,
  },
  organisms: {
    all: ['organisms'] as const,
    list: () => ['organisms', 'list'] as const,
  },
  techniques: {
    all: ['techniques'] as const,
  },
  fileTypes: {
    all: ['fileTypes'] as const,
  },
  relationTypes: {
    all: ['relationTypes'] as const,
  },
  links: {
    list: (parentType: string, parentId: string) =>
      ['links', parentType, parentId] as const,
  },
  stats: {
    storage: ['stats', 'storage'] as const,
  },
  engines: {
    all: ['engines'] as const,
    methods: (engineId: string) => ['engines', 'methods', engineId] as const,
  },
};
