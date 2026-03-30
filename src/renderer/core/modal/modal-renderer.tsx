import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { observer } from 'mobx-react-lite';
import { useRef } from 'react';
import { Dialog, DialogOverlay, DialogPortal } from '@renderer/components/ui/dialog';
import { cn } from '@renderer/lib/utils';
import { modalRegistry, type ModalRegistryEntry } from './modal-registry';
import { modalStore } from './modal-store';

export const ModalRenderer = observer(function ModalRenderer() {
  const entry = (
    modalStore.activeModalId
      ? modalRegistry[modalStore.activeModalId as keyof typeof modalRegistry]
      : null
  ) as ModalRegistryEntry | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Component = entry?.component as React.ComponentType<any> | undefined;

  // Preserve the last rendered content so the close animation plays with full-height content
  // rather than shrinking to zero while the popup fades out.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastComponentRef = useRef<React.ComponentType<any> | null>(null);
  const lastArgsRef = useRef<Record<string, unknown> | null>(null);

  if (modalStore.isOpen && Component && modalStore.activeModalArgs) {
    lastComponentRef.current = Component;
    lastArgsRef.current = modalStore.activeModalArgs;
  }

  const DisplayComponent = lastComponentRef.current;
  const displayArgs = lastArgsRef.current;

  const handleOpenChange = (
    open: boolean,
    eventDetails: DialogPrimitive.Root.ChangeEventDetails
  ) => {
    if (!open && modalStore.isOpen) {
      const isPassiveDismiss =
        eventDetails.reason === 'outside-press' || eventDetails.reason === 'escape-key';
      if (modalStore.closeGuardActive && isPassiveDismiss) return;
      modalStore.closeModal();
    }
  };

  // CommandPaletteModal (and any future usesOwnShell modals) manage their own visual
  // presentation via a portal. Render without the persistent Popup shell so the
  // empty dialog container doesn't show behind the palette.
  if (entry?.usesOwnShell) {
    return (
      <Dialog open={modalStore.isOpen} onOpenChange={handleOpenChange}>
        {DisplayComponent && displayArgs ? <DisplayComponent {...displayArgs} /> : null}
      </Dialog>
    );
  }

  return (
    <Dialog open={modalStore.isOpen} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup
          finalFocus={false}
          data-slot="dialog-content"
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex flex-col w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 bg-background text-sm ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-lg data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out rounded-xl overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95',
            entry?.popupClassName
          )}
        >
          {DisplayComponent && displayArgs ? <DisplayComponent {...displayArgs} /> : null}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
});
