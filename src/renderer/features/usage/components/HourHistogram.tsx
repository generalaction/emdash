import { fmtTokens } from '../format';
import { ChartTooltip, useChartHover } from './ChartTooltip';

function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

export function HourHistogram({ byHour }: { byHour: number[] }) {
  const max = Math.max(1, ...byHour);
  const { ref, hover, show, hide } = useChartHover();

  return (
    <div ref={ref} className="relative" onMouseLeave={hide}>
      <div className="flex h-24 items-stretch gap-[3px]">
        {byHour.map((v, h) => (
          // Full-height column so the whole strip is hoverable, not just the short bar.
          <div
            key={h}
            className="group flex flex-1 cursor-default flex-col justify-end"
            onMouseEnter={(e) => show(e, `${fmtTokens(v)} tokens · ${hourLabel(h)}`)}
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

      <ChartTooltip hover={hover} />
    </div>
  );
}
