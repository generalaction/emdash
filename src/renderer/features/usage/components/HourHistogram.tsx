import { useRef, useState } from 'react';
import { cn } from '@renderer/utils/utils';
import { fmtTokens } from '../format';

function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

type Hover = { x: number; y: number; text: string; w: number };

export function HourHistogram({ byHour }: { byHour: number[] }) {
  const max = Math.max(1, ...byHour);
  const [hover, setHover] = useState<Hover | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
      <div className="flex h-24 items-stretch gap-[3px]">
        {byHour.map((v, h) => (
          // Full-height column so the whole strip is hoverable, not just the short bar.
          <div
            key={h}
            className="group flex flex-1 cursor-default flex-col justify-end"
            onMouseEnter={(e) => {
              const rect = wrapRef.current?.getBoundingClientRect();
              if (!rect) return;
              setHover({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
                w: rect.width,
                text: `${fmtTokens(v)} tokens · ${hourLabel(h)}`,
              });
            }}
          >
            <div
              className="rounded-sm bg-foreground/30 transition-colors group-hover:bg-foreground/70"
              style={{ height: `${(v / max) * 100}%`, minHeight: '2px' }}
            />
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex justify-between text-[10px] text-foreground/40">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>11p</span>
      </div>

      {hover &&
        (() => {
          const tipW = Math.min(hover.text.length * 6.8 + 18, 260);
          const left = Math.max(tipW / 2 + 2, Math.min(hover.x, hover.w - tipW / 2 - 2));
          return (
            <div
              className={cn(
                'pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border',
                'border-border bg-background-2 px-2 py-1 text-xs whitespace-nowrap text-foreground shadow-md'
              )}
              style={{ left, top: hover.y - 8 }}
            >
              {hover.text}
            </div>
          );
        })()}
    </div>
  );
}
