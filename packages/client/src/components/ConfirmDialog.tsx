import * as Dialog from '@radix-ui/react-dialog';
import { useConfirmStore } from '../hooks/useConfirm';
import { Button, Heading, Text } from '../ui';

/**
 * Rendered once in App.tsx. Reacts to useConfirmStore — no props, no {dialog}
 * scattered across pages. Focus trapping, escape key, and aria-modal are all
 * handled by Radix.
 */
export default function ConfirmDialog() {
  const { open, title, message, confirmLabel, destructive, respond } = useConfirmStore();

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) respond(false); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/75 z-modal animate-fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-modal
                     bg-elevated border border-line rounded-lg shadow-lg
                     p-3 w-full max-w-sm mx-2 animate-fade-in"
          onPointerDownOutside={() => respond(false)}
        >
          <Dialog.Title asChild>
            <Heading level="subheading" className="mb-1">{title}</Heading>
          </Dialog.Title>
          <Dialog.Description asChild>
            <Text variant="body" as="p" className="mb-3">{message}</Text>
          </Dialog.Description>
          <div className="flex justify-end gap-1.5">
            <Button intent="ghost" size="sm" onClick={() => respond(false)}>Cancel</Button>
            <Button
              intent={destructive ? 'danger' : 'primary'}
              size="sm"
              onClick={() => respond(true)}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
