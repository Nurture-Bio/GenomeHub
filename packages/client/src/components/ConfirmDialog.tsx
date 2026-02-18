import { modalOverlay, modalCard } from '../ui/recipes';
import { Button, Heading, Text } from '../ui';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm',
  destructive = false, onConfirm, onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className={modalOverlay()} onClick={onCancel}>
      <div className={modalCard()} onClick={(e) => e.stopPropagation()}>
        <Heading level="subheading" className="mb-1">{title}</Heading>
        <Text variant="body" as="p" className="mb-3">{message}</Text>
        <div className="flex justify-end gap-1.5">
          <Button intent="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            intent={destructive ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
