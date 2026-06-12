import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { BrowserAnnotationState } from './browser-annotation-store';

const DRAFT_CARD_WIDTH = 320;
const DRAFT_CARD_ESTIMATED_HEIGHT = 190;

export const BrowserAnnotationOverlay = observer(function BrowserAnnotationOverlay({
  state,
  onCommitDraft,
  onCancelDraft,
  onRemoveAnnotation,
}: {
  state: BrowserAnnotationState;
  onCommitDraft: (comment: string) => void;
  onCancelDraft: () => void;
  onRemoveAnnotation: (token: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const sync = () => {
      setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    };
    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  const draft = state.draft;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {state.markers.map((marker) => (
        <Tooltip key={marker.token}>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="bg-primary text-primary-foreground hover:bg-destructive pointer-events-auto absolute flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-semibold shadow-md transition-colors"
                style={{ left: marker.rect.x, top: marker.rect.y }}
                aria-label={`Remove annotation ${marker.ordinal}`}
                onClick={() => onRemoveAnnotation(marker.token)}
              >
                {marker.ordinal}
              </button>
            }
          />
          <TooltipContent className="max-w-72">
            <span className="block truncate">{marker.comment}</span>
            <span className="block text-xs text-foreground-muted">Click to remove</span>
          </TooltipContent>
        </Tooltip>
      ))}
      {draft && (
        <>
          <div
            className="border-primary bg-primary/10 pointer-events-none absolute rounded-sm border-2"
            style={{
              left: draft.element.rect.x,
              top: draft.element.rect.y,
              width: draft.element.rect.width,
              height: draft.element.rect.height,
            }}
          />
          <DraftCommentCard
            key={draft.token}
            elementLabel={
              draft.element.component
                ? `${draft.element.component} — ${draft.element.selector}`
                : draft.element.selector
            }
            position={draftCardPosition(draft.element.rect, containerSize)}
            onCommit={onCommitDraft}
            onCancel={onCancelDraft}
          />
        </>
      )}
    </div>
  );
});

function draftCardPosition(
  rect: { x: number; y: number; width: number; height: number },
  container: { width: number; height: number }
): { left: number; top: number } {
  const left = Math.max(8, Math.min(rect.x, container.width - DRAFT_CARD_WIDTH - 8));
  const below = rect.y + rect.height + 8;
  const top =
    below + DRAFT_CARD_ESTIMATED_HEIGHT > container.height
      ? Math.max(8, rect.y - DRAFT_CARD_ESTIMATED_HEIGHT - 8)
      : below;
  return { left, top };
}

function DraftCommentCard({
  elementLabel,
  position,
  onCommit,
  onCancel,
}: {
  elementLabel: string;
  position: { left: number; top: number };
  onCommit: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState('');
  const canCommit = comment.trim().length > 0;

  const commit = () => {
    if (canCommit) onCommit(comment);
  };

  return (
    <div
      className="pointer-events-auto absolute flex w-80 flex-col gap-2 rounded-md bg-background-quaternary p-3 shadow-md ring-1 ring-foreground/10"
      style={{ left: position.left, top: position.top }}
    >
      <div className="truncate font-mono text-xs text-foreground-muted" title={elementLabel}>
        {elementLabel}
      </div>
      <Textarea
        autoFocus
        value={comment}
        placeholder="Describe the change for this element…"
        className="max-h-40 min-h-20 text-sm"
        onChange={(event) => setComment(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={!canCommit} onClick={commit}>
          Add annotation
        </Button>
      </div>
    </div>
  );
}
