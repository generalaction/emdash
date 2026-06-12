import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Shortcut } from '@renderer/lib/ui/shortcut';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { BrowserAnnotationState } from './browser-annotation-store';
import type { AnnotatedElementInfo } from './browser-annotation-types';

const DRAFT_CARD_WIDTH = 320;
const DRAFT_CARD_ESTIMATED_HEIGHT = 170;

export const BrowserAnnotationOverlay = observer(function BrowserAnnotationOverlay({
  state,
  zoomFactor,
  onCommitDraft,
  onCancelDraft,
  onRemoveAnnotation,
}: {
  state: BrowserAnnotationState;
  /** Page zoom — picker rects are in page CSS pixels, the overlay in embedder pixels. */
  zoomFactor: number;
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
  const draftRect = draft ? scaleRect(draft.element.rect, zoomFactor) : null;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {state.markers.map((marker) => {
        const rect = scaleRect(marker.rect, zoomFactor);
        return (
          <Tooltip key={`${state.navigationEpoch}:${marker.token}`}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="pointer-events-auto absolute flex size-5 -translate-x-1/2 -translate-y-1/2 animate-in items-center justify-center rounded-full bg-blue-500 text-[11px] font-semibold text-white tabular-nums shadow-md ring-2 ring-white/90 transition-[scale,background-color] duration-150 fade-in-0 zoom-in-75 hover:bg-red-500 active:scale-[0.96]"
                  style={{ left: rect.x, top: rect.y }}
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
        );
      })}
      {draft && draftRect && (
        <>
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-blue-500 bg-blue-500/10"
            style={{
              left: draftRect.x,
              top: draftRect.y,
              width: draftRect.width,
              height: draftRect.height,
            }}
          />
          <DraftCommentCard
            key={draft.token}
            element={draft.element}
            position={draftCardPosition(draftRect, containerSize)}
            onCommit={onCommitDraft}
            onCancel={onCancelDraft}
          />
        </>
      )}
    </div>
  );
});

function scaleRect(
  rect: { x: number; y: number; width: number; height: number },
  zoomFactor: number
): { x: number; y: number; width: number; height: number } {
  if (zoomFactor === 1) return rect;
  return {
    x: rect.x * zoomFactor,
    y: rect.y * zoomFactor,
    width: rect.width * zoomFactor,
    height: rect.height * zoomFactor,
  };
}

function annotationTargetLabel(element: AnnotatedElementInfo): string {
  const base = element.component ?? `<${element.tag}>`;
  if (!element.text) return base;
  const text = element.text.length > 40 ? `${element.text.slice(0, 40)}…` : element.text;
  return `${base} · “${text}”`;
}

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
  element,
  position,
  onCommit,
  onCancel,
}: {
  element: AnnotatedElementInfo;
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
      className="pointer-events-auto absolute flex w-80 animate-in flex-col rounded-lg bg-background-quaternary p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_4px_12px_rgba(0,0,0,0.1),0_12px_32px_rgba(0,0,0,0.08)] duration-150 fade-in-0 slide-in-from-top-1"
      style={{ left: position.left, top: position.top }}
    >
      <div className="truncate pb-1 text-xs font-medium text-foreground-muted">
        {annotationTargetLabel(element)}
      </div>
      <Textarea
        autoFocus
        value={comment}
        placeholder="Describe the change…"
        className="min-h-16 resize-none border-0 bg-transparent p-0 text-sm shadow-none hover:border-0 focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
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
      <div className="flex items-center justify-end gap-1.5 pt-2">
        <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5"
          disabled={!canCommit}
          onClick={commit}
        >
          Add
          <Shortcut
            hotkey="Mod+Enter"
            className="px-0 py-0 text-[11px] text-current opacity-60 in-data-[slot=tooltip-content]:text-current"
          />
        </Button>
      </div>
    </div>
  );
}
