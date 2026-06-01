import { useMemo, useState } from 'react';
import { cn } from '@renderer/utils/utils';
import type { DailyPoint } from '@shared/usage';
import { fmtTokens } from '../format';

type Mode = 'daily' | 'weekly';

const WEEKS = 53;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Monochrome intensity scale built from emdash's foreground token.
const LEVEL_BG = [
  'bg-foreground/[0.06]',
  'bg-foreground/20',
  'bg-foreground/35',
  'bg-foreground/55',
  'bg-foreground/80',
];

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function levelOf(tokens: number, max: number): number {
  if (tokens <= 0) return 0;
  const r = Math.sqrt(tokens / max); // sqrt spreads the long tail of low-volume days
  return Math.min(4, Math.max(1, Math.ceil(r * 4)));
}

type Cell = { date: Date; tokens: number; future: boolean };

export function ActivityHeatmap({ daily }: { daily: DailyPoint[] }) {
  const [mode, setMode] = useState<Mode>('daily');

  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of daily) m.set(d.date, d.tokens);
    return m;
  }, [daily]);

  const { columns, weekTotals, monthLabels, maxDaily, maxWeekly } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7); // Sunday, WEEKS ago

    const columns: Cell[][] = [];
    let maxDaily = 0;
    for (let w = 0; w < WEEKS; w++) {
      const col: Cell[] = [];
      for (let dow = 0; dow < 7; dow++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + dow);
        const future = date.getTime() > today.getTime();
        const tokens = future ? 0 : (byDate.get(ymd(date)) ?? 0);
        if (tokens > maxDaily) maxDaily = tokens;
        col.push({ date, tokens, future });
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

    return { columns, weekTotals, monthLabels, maxDaily: Math.max(1, maxDaily), maxWeekly };
  }, [byDate]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[10px] font-medium tracking-wider text-foreground/40 uppercase">
          Token activity
        </div>
        <div className="flex items-center gap-3 text-xs">
          {(['daily', 'weekly'] as Mode[]).map((m) => (
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

      <div className="overflow-x-auto">
        <div className="inline-flex flex-col gap-1">
          <div className="flex gap-[3px]">
            {columns.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-[3px]">
                {col.map((cell, ri) => {
                  const value = mode === 'weekly' ? weekTotals[ci] : cell.tokens;
                  const max = mode === 'weekly' ? maxWeekly : maxDaily;
                  const level = cell.future ? -1 : levelOf(value, max);
                  return (
                    <div
                      key={ri}
                      className={cn(
                        'h-2.5 w-2.5 rounded-[2px]',
                        cell.future ? 'bg-transparent' : LEVEL_BG[level]
                      )}
                      title={
                        cell.future
                          ? undefined
                          : `${fmtTokens(cell.tokens)} tokens on ${MONTHS[cell.date.getMonth()]} ${cell.date.getDate()}`
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px] text-[10px] text-foreground/40">
            {monthLabels.map((label, i) => (
              <div key={i} className="w-2.5 shrink-0 overflow-visible whitespace-nowrap">
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
