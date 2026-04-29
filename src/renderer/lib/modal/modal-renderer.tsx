import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import {
  modalRegistry,
  type ModalRegistryEntry,
  type ModalSize,
} from '@renderer/app/modal-registry';
import { Dialog, DialogOverlay, DialogPortal } from '@renderer/lib/ui/dialog';
import { cn } from '@renderer/utils/utils';
import { modalStore } from './modal-store';

const SIZE_CLASSES: Record<ModalSize, string> = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
};

export const ModalRenderer = observer(function ModalRenderer() {
  const entry = (
    modalStore.activeModalId
      ? modalRegistry[modalStore.activeModalId as keyof typeof modalRegistry]
      : null
  ) as ModalRegistryEntry | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Component = entry?.component as React.ComponentType<any> | undefined;

  // Preserve the last rendered content and entry config so the close animation plays with the
  // correct dimensions and full content rather than collapsing while the popup fades out.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastComponentRef = useRef<React.ComponentType<any> | null>(null);
  const lastArgsRef = useRef<Record<string, unknown> | null>(null);
  const lastEntryRef = useRef<ModalRegistryEntry | null>(null);

  if (modalStore.isOpen && Component && modalStore.activeModalArgs) {
    lastComponentRef.current = Component;
    lastArgsRef.current = modalStore.activeModalArgs;
    lastEntryRef.current = entry;
  }

  const DisplayComponent = lastComponentRef.current;
  const displayArgs = lastArgsRef.current;
  const displayEntry = lastEntryRef.current;

  const handleOpenChange = (
    open: boolean,
    eventDetails: DialogPrimitive.Root.ChangeEventDetails
  ) => {
    if (!open && modalStore.isOpen) {
      const isPassiveDismiss =
        eventDetails.reason === 'outside-press' || eventDetails.reason === 'escape-key';
      if (modalStore.closeGuardActive && isPassiveDismiss) return;
      modalStore.activeModalArgs?.onClose?.();
    }
  };

  return (
    <Dialog open={modalStore.isOpen} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          finalFocus={false}
          data-slot="dialog-content"
          onKeyDownCapture={(e) => {
            if ((e.metaKey || e.ctrlKey || e.altKey) && e.key === 'Enter') {
              e.preventDefault();
            }
          }}
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex flex-col w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 bg-background-quaternary text-sm ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out rounded-xl overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
            SIZE_CLASSES[displayEntry?.size ?? 'md']
          )}
        >
          {DisplayComponent && displayArgs ? <DisplayComponent {...displayArgs} /> : null}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
});
