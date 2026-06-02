import { useMemo, useRef, useState } from 'react';
import { cn } from '@renderer/utils/utils';
import type { DailyPoint } from '@shared/usage';
import { fmtTokens } from '../format';

type Mode = 'daily' | 'weekly' | 'cumulative';

const MODES: Mode[] = ['daily', 'weekly', 'cumulative'];
const WEEKS = 53;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Monochrome intensity scale built from emdash's foreground token. Index 0 = empty.
const LEVEL_BG = [
  'bg-foreground/[0.08]',
  'bg-foreground/25',
  'bg-foreground/40',
  'bg-foreground/60',
  'bg-foreground/85',
];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function levelOf(value: number, max: number): number {
  if (value <= 0) return 0;
  const r = Math.sqrt(value / max); // sqrt spreads the long tail of low-volume days
  return Math.min(4, Math.max(1, Math.ceil(r * 4)));
}

type Cell = { date: Date; tokens: number; cumulative: number; future: boolean };
type Hover = { x: number; y: number; text: string };

export function ActivityHeatmap({ daily }: { daily: DailyPoint[] }) {
  const [mode, setMode] = useState<Mode>('daily');
  const [hover, setHover] = useState<Hover | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of daily) m.set(d.date, d.tokens);
    return m;
  }, [daily]);

  const { columns, weekTotals, monthLabels, maxDaily, maxWeekly, maxCumulative } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7); // Sunday, WEEKS ago

    const columns: Cell[][] = [];
    let maxDaily = 0;
    let running = 0;
    for (let w = 0; w < WEEKS; w++) {
      const col: Cell[] = [];
      for (let dow = 0; dow < 7; dow++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + dow);
        const future = date.getTime() > today.getTime();
        const tokens = future ? 0 : (byDate.get(ymd(date)) ?? 0);
        if (tokens > maxDaily) maxDaily = tokens;
        if (!future) running += tokens; // columns build chronologically
        col.push({ date, tokens, cumulative: running, future });
      }
      columns.push(col);
    }

    const weekTotals = columns.map((col) => col.reduce((s, c) => s + (c.future ? 0 : c.tokens), 0));
    const maxWeekly = Math.max(1, ...weekTotals);

    const monthLabels = columns.map((col, i) => {
      const month = col[0].date.getMonth();
      const prevMonth = i > 0 ? columns[i - 1][0].date.getMonth() : -1;
      return month !== prevMonth ? MONTHS[month] : '';
    });

    return {
      columns,
      weekTotals,
      monthLabels,
      maxDaily: Math.max(1, maxDaily),
      maxWeekly,
      maxCumulative: Math.max(1, running),
    };
  }, [byDate]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] font-medium tracking-wider text-foreground/40 uppercase">
          Token activity
        </div>
        <div className="flex items-center gap-3 text-xs">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'capitalize transition-colors',
                mode === m
                  ? 'font-medium text-foreground'
                  : 'text-foreground/40 hover:text-foreground'
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Columns flex to fill the panel width, like the GitHub contribution graph. */}
      <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
        <div className="flex w-full gap-[3px]">
          {columns.map((col, ci) => (
            <div key={ci} className="flex min-w-0 flex-1 flex-col gap-[3px]">
              {col.map((cell, ri) => {
                const value =
                  mode === 'weekly'
                    ? weekTotals[ci]
                    : mode === 'cumulative'
                      ? cell.cumulative
                      : cell.tokens;
                const max =
                  mode === 'weekly' ? maxWeekly : mode === 'cumulative' ? maxCumulative : maxDaily;
                const level = levelOf(value, max);
                return (
                  <div
                    key={ri}
                    className={cn(
                      'aspect-square w-full rounded-[3px]',
                      cell.future ? 'bg-transparent' : LEVEL_BG[level]
                    )}
                    onMouseEnter={(e) => {
                      if (cell.future) return;
                      const rect = wrapRef.current?.getBoundingClientRect();
                      if (!rect) return;
                      setHover({
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                        text: `${fmtTokens(cell.tokens)} tokens on ${MONTHS[cell.date.getMonth()]} ${cell.date.getDate()}`,
                      });
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-1.5 flex w-full items-center gap-[3px]">
          <div className="flex min-w-0 flex-1 gap-[3px]">
            {monthLabels.map((label, i) => (
              <div
                key={i}
                className="min-w-0 flex-1 overflow-visible text-left text-[10px] whitespace-nowrap text-foreground/40"
              >
                {label}
              </div>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1 pl-3 text-[10px] text-foreground/40">
            <span>Less</span>
            {LEVEL_BG.map((bg, i) => (
              <span key={i} className={cn('h-2.5 w-2.5 rounded-[2px]', bg)} />
            ))}
            <span>More</span>
          </div>
        </div>

        {hover && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-background-2 px-2 py-1 text-xs whitespace-nowrap text-foreground shadow-md"
            style={{ left: hover.x, top: hover.y - 8 }}
          >
            {hover.text}
          </div>
        )}
      </div>
    </div>
  );
}
