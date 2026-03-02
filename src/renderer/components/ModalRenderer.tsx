import { Dialog } from '@/components/ui/dialog';
import { useModalContext } from '@/contexts/ModalProvider';
import { useMemo } from 'react';

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
