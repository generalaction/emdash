import { MousePointer2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import type {
  BrowserAnnotationBoundingBox,
  BrowserAnnotationTarget,
} from '@shared/browserAnnotations';
import {
  buildBrowserAnnotationCaptureScript,
  parseBrowserAnnotationCaptureResult,
  withAreaBoundingBox,
} from './browser-annotation-capture';
import type { BrowserAnnotationsStore } from './browser-annotations-store';
import type { BrowserWebviewAdapter } from './browser-webview-types';

type Point = {
  x: number;
  y: number;
};

type DraftSelection = {
  origin: Point;
  current: Point;
};

type ComposerState = {
  target: BrowserAnnotationTarget;
  anchor: Point;
};

const MIN_AREA_SIZE = 8;
const HOVER_CAPTURE_DELAY_MS = 80;

export const BrowserAnnotationOverlay = observer(function BrowserAnnotationOverlay({
  active,
  adapter,
  browserId,
  store,
  onClose,
}: {
  active: boolean;
  adapter: BrowserWebviewAdapter | null;
  browserId: string;
  store: BrowserAnnotationsStore | null;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState<DraftSelection | null>(null);
  const [hoverTarget, setHoverTarget] = useState<BrowserAnnotationTarget | null>(null);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [comment, setComment] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverSequenceRef = useRef(0);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current === null) return;
    window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (!active) {
      clearHoverTimer();
      setDraft(null);
      setHoverTarget(null);
      setComposer(null);
      setComment('');
    }
  }, [active, clearHoverTimer]);

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  useEffect(() => {
    if (!composer) return;
    const timer = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [composer]);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (composer) {
        closeComposer();
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, composer, onClose]);

  const pendingCount = store?.pendingCount ?? 0;

  const draftBox = useMemo(
    () => (draft ? normalizeBox(draft.origin, draft.current) : null),
    [draft]
  );

  const inspectPoint = useCallback(
    async (point: Point, kind: BrowserAnnotationTarget['kind'] = 'element') => {
      if (!adapter) return null;
      const script = buildBrowserAnnotationCaptureScript(point.x, point.y, kind);
      const result = await adapter.executeJavaScript(script);
      return parseBrowserAnnotationCaptureResult(result);
    },
    [adapter]
  );

  const pointFromEvent = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(Math.max(0, Math.min(rect.width, event.clientX - rect.left))),
      y: Math.round(Math.max(0, Math.min(rect.height, event.clientY - rect.top))),
    };
  };

  const updateHoverTarget = useCallback(
    async (point: Point) => {
      if (!active || composer || draft || isCapturing) return;
      const sequence = ++hoverSequenceRef.current;
      const target = await inspectPoint(point);
      if (sequence === hoverSequenceRef.current) {
        setHoverTarget(target);
      }
    },
    [active, composer, draft, inspectPoint, isCapturing]
  );

  const scheduleHoverTargetUpdate = useCallback(
    (point: Point) => {
      clearHoverTimer();
      if (!active || composer || draft || isCapturing) return;
      hoverTimerRef.current = window.setTimeout(() => {
        hoverTimerRef.current = null;
        void updateHoverTarget(point);
      }, HOVER_CAPTURE_DELAY_MS);
    },
    [active, clearHoverTimer, composer, draft, isCapturing, updateHoverTarget]
  );

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!active || !adapter || composer) return;
    const point = pointFromEvent(event);
    if (draft) {
      setDraft({ ...draft, current: point });
      return;
    }
    scheduleHoverTargetUpdate(point);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!active || !adapter || event.button !== 0 || composer) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    clearHoverTimer();
    const point = pointFromEvent(event);
    setDraft({ origin: point, current: point });
    setHoverTarget(null);
  };

  const handlePointerUp = async (event: React.PointerEvent<HTMLDivElement>) => {
    if (!active || !adapter || !draft || composer) return;
    event.preventDefault();
    event.currentTarget.releasePointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    const box = normalizeBox(draft.origin, point);
    setDraft(null);
    setIsCapturing(true);
    try {
      const isArea = box.width >= MIN_AREA_SIZE || box.height >= MIN_AREA_SIZE;
      const capturePoint = isArea
        ? { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
        : point;
      const captured = await inspectPoint(capturePoint, isArea ? 'area' : 'element');
      if (!captured) return;
      const target = isArea ? withAreaBoundingBox(captured, box) : captured;
      openComposer(target, capturePoint);
    } finally {
      setIsCapturing(false);
    }
  };

  const openComposer = (target: BrowserAnnotationTarget, anchor: Point) => {
    setComposer({ target, anchor });
    setComment('');
    setHoverTarget(null);
  };

  const closeComposer = () => {
    setComposer(null);
    setComment('');
  };

  const saveAnnotation = () => {
    const content = comment.trim();
    if (!composer || !store || !content) return;
    store.addAnnotation({
      ...composer.target,
      browserId,
      comment: content,
    });
    closeComposer();
  };

  if (!active) return null;

  const selectedTarget = composer?.target ?? hoverTarget;
  const composerStyle = composerPositionStyle(composer?.anchor, overlayRef.current);

  return (
    <div
      ref={overlayRef}
      className={cn(
        'absolute inset-0 z-10 cursor-crosshair overflow-hidden bg-transparent',
        isCapturing && 'cursor-progress'
      )}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      aria-label="Browser annotation overlay"
    >
      <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-1.5 rounded-md border border-blue-500/30 bg-background/95 px-2 py-1 text-xs text-foreground shadow-sm">
        <MousePointer2 className="size-3.5 text-blue-500" />
        <span>Annotation mode</span>
        {pendingCount > 0 && (
          <Badge
            variant="secondary"
            className="h-4 border-blue-500/20 bg-blue-500/10 text-blue-600"
          >
            {pendingCount}
          </Badge>
        )}
      </div>

      {selectedTarget && <TargetBox box={selectedTarget.boundingBox} active={Boolean(composer)} />}
      {draftBox && (draftBox.width >= MIN_AREA_SIZE || draftBox.height >= MIN_AREA_SIZE) && (
        <TargetBox box={draftBox} active />
      )}

      {composer && (
        <div
          className="absolute z-20 flex w-80 max-w-[calc(100%-1rem)] flex-col gap-2 rounded-md border border-border bg-background p-2 shadow-xl"
          style={composerStyle}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onPointerMove={(event) => event.stopPropagation()}
        >
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0 truncate text-xs font-medium text-foreground">
              {targetLabel(composer.target)}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Cancel annotation"
              onClick={closeComposer}
            >
              <X className="size-3.5" />
            </Button>
          </div>
          <Textarea
            ref={textareaRef}
            value={comment}
            onChange={(event) => setComment(event.currentTarget.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                saveAnnotation();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                closeComposer();
              }
            }}
            className="min-h-20 resize-none text-sm"
            placeholder="Describe the change"
          />
          <div className="flex items-center justify-end gap-1.5">
            <Button type="button" variant="ghost" size="sm" onClick={closeComposer}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!comment.trim() || !store}
              onClick={saveAnnotation}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

function normalizeBox(a: Point, b: Point): BrowserAnnotationBoundingBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function TargetBox({ box, active }: { box: BrowserAnnotationBoundingBox; active: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute rounded-[3px] border bg-blue-500/10 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]',
        active ? 'border-blue-500/80' : 'border-blue-500/55'
      )}
      style={{
        left: box.x,
        top: box.y,
        width: Math.max(1, box.width),
        height: Math.max(1, box.height),
      }}
    />
  );
}

function composerPositionStyle(
  anchor: Point | undefined,
  container: HTMLDivElement | null
): CSSProperties {
  if (!anchor || !container) return { left: 8, top: 8 };
  const width = container.clientWidth;
  const height = container.clientHeight;
  const left = Math.max(8, Math.min(width - 328, anchor.x + 12));
  const top = Math.max(8, Math.min(height - 220, anchor.y + 12));
  return { left, top };
}

function targetLabel(target: BrowserAnnotationTarget): string {
  if (target.kind === 'area') return 'Area annotation';
  if (target.kind === 'text') return 'Text annotation';
  const classes = target.cssClasses
    ? `.${target.cssClasses.split(/\s+/).slice(0, 2).join('.')}`
    : '';
  return `${target.element}${classes}`;
}
