import type { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useMemo } from 'react';
import { Dialog } from '@renderer/components/ui/dialog';
import { useModalContext } from '@renderer/core/modal-provider';

export function ModalRenderer() {
  const { activeModalId, renderModal, closeModal, hasActiveCloseGuard } = useModalContext();
  const content = useMemo(
    () => (activeModalId ? renderModal() : null),
    [renderModal, activeModalId]
  );

  const handleOpenChange = (
    open: boolean,
    eventDetails: DialogPrimitive.Root.ChangeEventDetails
  ) => {
    if (!open && activeModalId !== null) {
      const isPassiveDismiss =
        eventDetails.reason === 'outside-press' || eventDetails.reason === 'escape-key';
      if (hasActiveCloseGuard && isPassiveDismiss) return;
      closeModal();
    }
  };

  return (
    <Dialog open={activeModalId !== null} onOpenChange={handleOpenChange}>
      {content}
    </Dialog>
  );
}
