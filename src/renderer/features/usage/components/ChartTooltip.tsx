import { useRef, useState } from 'react';

type Hover = { x: number; y: number; text: string; w: number };

/**
 * Shared hover state for the SVG-less charts. Owns the wrapper ref and converts a mouse
 * event into panel-relative coordinates so the tooltip can be absolutely positioned and
 * clamped. Spread `ref` onto the `relative` wrapper and wire `hide` to its `onMouseLeave`.
 */
export function useChartHover() {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);

  const show = (e: { clientX: number; clientY: number }, text: string): void => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, text });
  };
  const hide = (): void => setHover(null);

  return { ref, hover, show, hide };
}

export function ChartTooltip({ hover }: { hover: Hover | null }) {
  if (!hover) return null;
  // Clamp horizontally so the bubble never overflows (and gets clipped by) the panel.
  const tipW = Math.min(hover.text.length * 6.8 + 18, 260);
  const left = Math.max(tipW / 2 + 2, Math.min(hover.x, hover.w - tipW / 2 - 2));
  return (
    <div
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-background-2 px-2 py-1 text-xs whitespace-nowrap text-foreground shadow-md"
      style={{ left, top: hover.y - 8 }}
    >
      {hover.text}
    </div>
  );
}
