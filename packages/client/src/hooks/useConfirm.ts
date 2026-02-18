import { useState, useCallback, createElement } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}

export function useConfirm() {
  const [state, setState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setState({ options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);

  const dialog = state
    ? createElement(ConfirmDialog, {
        open: true,
        title: state.options.title,
        message: state.options.message,
        confirmLabel: state.options.confirmLabel,
        destructive: state.options.destructive,
        onConfirm: handleConfirm,
        onCancel: handleCancel,
      })
    : null;

  return { confirm, dialog };
}
