import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface ConfirmStoreState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive: boolean;
  _resolve: ((v: boolean) => void) | null;
  show: (options: ConfirmOptions) => Promise<boolean>;
  respond: (v: boolean) => void;
}

export const useConfirmStore = create<ConfirmStoreState>((set, get) => ({
  open: false,
  title: '',
  message: '',
  confirmLabel: 'Confirm',
  destructive: false,
  _resolve: null,

  show: (options) =>
    new Promise<boolean>((resolve) => {
      set({
        open: true,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? 'Confirm',
        destructive: options.destructive ?? false,
        _resolve: resolve,
      });
    }),

  respond: (v) => {
    get()._resolve?.(v);
    set({ open: false, _resolve: null });
  },
}));

/** Call confirm() anywhere — no {dialog} to render in your component. */
export function useConfirm() {
  const confirm = useConfirmStore((s) => s.show);
  return { confirm };
}
