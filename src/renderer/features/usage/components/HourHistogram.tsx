import { fmtTokens } from '../format';

function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

export function HourHistogram({ byHour }: { byHour: number[] }) {
  const max = Math.max(1, ...byHour);
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]">
        {byHour.map((v, h) => (
          <div
            key={h}
            className="flex-1 rounded-sm bg-foreground/30"
            style={{ height: `${(v / max) * 100}%`, minHeight: '2px' }}
            title={`${fmtTokens(v)} tokens · ${hourLabel(h)}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-foreground/40">
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>11p</span>
      </div>
    </div>
  );
}
