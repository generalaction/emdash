import { useMemo } from 'react';
import { Dialog } from '@renderer/components/ui/dialog';
import { useModalContext } from '@renderer/contexts/ModalProvider';

export function ModalRenderer() {
  const { activeModalId, renderModal, closeModal } = useModalContext();
  const content = useMemo(
    () => (activeModalId ? renderModal() : null),
    [renderModal, activeModalId]
  );
  return (
    <Dialog
      open={activeModalId !== null}
      onOpenChange={(open) => {
        if (!open && activeModalId !== null) {
          closeModal();
        }
      }}
    >
      {content}
    </Dialog>
  );
}
