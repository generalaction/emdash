import { useMemo } from 'react';
import { cn } from '@renderer/utils/utils';
import type { DailyPoint } from '@shared/usage';
import { fmtTokens } from '../format';
import { ChartTooltip, useChartHover } from './ChartTooltip';

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

type Cell = { date: Date; tokens: number; future: boolean };

/** GitHub-style contribution graph: one square per day over the past ~year, shaded by tokens. */
export function ActivityHeatmap({ daily }: { daily: DailyPoint[] }) {
  const { ref, hover, show, hide } = useChartHover();

  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of daily) m.set(d.date, d.tokens);
    return m;
  }, [daily]);

  const { columns, monthLabels, maxDaily } = useMemo(() => {
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

    const monthLabels = columns.map((col, i) => {
      const month = col[0].date.getMonth();
      const prevMonth = i > 0 ? columns[i - 1][0].date.getMonth() : -1;
      return month !== prevMonth ? MONTHS[month] : '';
    });

    return { columns, monthLabels, maxDaily: Math.max(1, maxDaily) };
  }, [byDate]);

  return (
    <div>
      <div className="mb-3 text-[10px] font-medium tracking-wider text-foreground/40 uppercase">
        Token activity · past year
      </div>

      {/* Columns flex to fill the panel width, like the GitHub contribution graph. */}
      <div ref={ref} className="relative" onMouseLeave={hide}>
        <div className="flex w-full gap-[3px]">
          {columns.map((col, ci) => (
            <div key={ci} className="flex min-w-0 flex-1 flex-col gap-[3px]">
              {col.map((cell, ri) => (
                <div
                  key={ri}
                  className={cn(
                    'aspect-square w-full rounded-[3px] transition-[box-shadow]',
                    cell.future ? 'bg-transparent' : LEVEL_BG[levelOf(cell.tokens, maxDaily)],
                    !cell.future && 'hover:ring-1 hover:ring-foreground/70'
                  )}
                  onMouseEnter={(e) => {
                    if (cell.future) return;
                    show(
                      e,
                      `${fmtTokens(cell.tokens)} tokens · ${MONTHS[cell.date.getMonth()]} ${cell.date.getDate()}`
                    );
                  }}
                />
              ))}
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

        <ChartTooltip hover={hover} />
      </div>
    </div>
  );
}
