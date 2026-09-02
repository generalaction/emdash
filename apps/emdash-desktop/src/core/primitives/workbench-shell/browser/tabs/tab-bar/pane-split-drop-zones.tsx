import { useDndContext, useDroppable } from '@dnd-kit/core';
import { cn } from '@core/primitives/styling/browser/cn';
import { splitDropId, type SplitSide } from '../split-drop-id';

/**
 * Edge drop zones that create a new split pane on drop (VS Code style).
 * Mounted only while a drag is active, so the strips never intercept normal
 * pointer interaction with the pane content. Hit area is the outer 20% of the
 * content region; the hover highlight previews the half where the new pane
 * lands. All drop-validity guards (pane cap, no-op splits) live in
 * PaneLayoutStore.handleDragEnd — a no-op drop simply leaves the layout as is.
 */
export function PaneSplitDropZones({ paneId }: { paneId: string }) {
  const { active } = useDndContext();
  if (!active) return null;
  return (
    <>
      <SplitZone paneId={paneId} side="left" />
      <SplitZone paneId={paneId} side="right" />
    </>
  );
}

function SplitZone({ paneId, side }: { paneId: string; side: SplitSide }) {
  const { setNodeRef, isOver } = useDroppable({ id: splitDropId(paneId, side) });
  return (
    <>
      <div
        ref={setNodeRef}
        className={cn('absolute inset-y-0 z-30 w-1/5', side === 'left' ? 'left-0' : 'right-0')}
      />
      {isOver && (
        <div
          className={cn(
            'pointer-events-none absolute inset-y-0 z-20 w-1/2 bg-foreground/10',
            side === 'left' ? 'left-0' : 'right-0'
          )}
        />
      )}
    </>
  );
}
