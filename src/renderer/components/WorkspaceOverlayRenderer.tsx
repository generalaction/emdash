import { Dialog } from '@/components/ui/dialog';
import { useWorkspaceOverlayContext } from '@/contexts/WorkspaceOverlayContext';
import { useMemo } from 'react';

export function WorkspaceOverlayRenderer() {
  const { activeOverlayId, renderOverlay, closeOverlay } = useWorkspaceOverlayContext();
  const content = useMemo(
    () => (activeOverlayId ? renderOverlay() : null),
    [renderOverlay, activeOverlayId]
  );
  return (
    <Dialog
      open={activeOverlayId !== null}
      onOpenChange={(open) => {
        if (!open && activeOverlayId !== null) {
          closeOverlay();
        }
      }}
    >
      {content}
    </Dialog>
  );
}
