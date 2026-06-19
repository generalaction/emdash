import { useLayoutEffect, useMemo, useRef, useState } from 'react';

export type Measure = (text: string) => number;

export function pickCompactedDisplay(
  segments: string[],
  maxWidth: number,
  measure: Measure
): string {
  if (segments.length === 0) return '';
  if (segments.length === 1) return fitOrEllipsize(segments[0], maxWidth, measure);

  const last = segments[segments.length - 1];
  const front = segments.slice(0, -1);

  const full = segments.join('/');
  if (measure(full) <= maxWidth) return full;

  for (let keptCount = front.length - 1; keptCount >= 0; keptCount--) {
    const kept = front.slice(0, keptCount);
    const baseCandidate = kept.length > 0 ? `${kept.join('/')}/.../${last}` : `.../${last}`;
    if (measure(baseCandidate) <= maxWidth) return baseCandidate;

    if (keptCount === 0) continue;

    const lastKept = kept[keptCount - 1];
    const prefixSegs = kept.slice(0, keptCount - 1);
    const prefix = prefixSegs.length > 0 ? `${prefixSegs.join('/')}/` : '';
    for (let len = lastKept.length - 1; len >= 1; len--) {
      const truncated = `${lastKept.slice(0, len)}...`;
      const partial = `${prefix}${truncated}/${last}`;
      if (measure(partial) <= maxWidth) return partial;
    }
  }

  return fitOrEllipsize(last, maxWidth, measure);
}

function fitOrEllipsize(text: string, maxWidth: number, measure: Measure): string {
  if (measure(text) <= maxWidth) return text;
  for (let len = text.length - 1; len >= 1; len--) {
    const truncated = `${text.slice(0, len)}...`;
    if (measure(truncated) <= maxWidth) return truncated;
  }
  return '...';
}

let measureCanvas: HTMLCanvasElement | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d');
}

function fontFromComputed(el: HTMLElement): string {
  const cs = window.getComputedStyle(el);
  const style = cs.fontStyle || 'normal';
  const weight = cs.fontWeight || '400';
  const size = cs.fontSize || '14px';
  const family = cs.fontFamily || 'sans-serif';
  return `${style} ${weight} ${size} ${family}`;
}

export function CompactedPathLabel({ path }: { path: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const segments = useMemo(() => path.split('/'), [path]);
  const [display, setDisplay] = useState(path);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = getMeasureContext();
    if (!ctx) return;

    let frame = 0;
    const recompute = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      ctx.font = fontFromComputed(el);
      const next = pickCompactedDisplay(segments, width, (s) => ctx.measureText(s).width);
      setDisplay((prev) => (prev === next ? prev : next));
    };

    recompute();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(recompute);
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [segments]);

  return (
    <span ref={ref} className="block overflow-hidden whitespace-nowrap" title={path}>
      {display}
    </span>
  );
}
