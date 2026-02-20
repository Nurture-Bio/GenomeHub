import { useCallback } from 'react';
import { useConfirm } from './useConfirm';

export function useConfirmDelete(
  deleteFn: (id: string) => Promise<void>,
  entityName: string,
) {
  const { confirm } = useConfirm();

  const confirmDelete = useCallback(async (id: string, displayName?: string) => {
    const ok = await confirm({
      title: `Delete ${entityName}`,
      message: `Are you sure you want to delete ${displayName ? `"${displayName}"` : `this ${entityName}`}? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) await deleteFn(id);
  }, [confirm, deleteFn, entityName]);

  return { confirmDelete };
}
