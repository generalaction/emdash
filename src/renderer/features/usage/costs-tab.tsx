import type { UsageSnapshot } from '@shared/usage';
import { BarRow } from './components/BarRow';
import { Sparkline } from './components/Sparkline';
import { StatCard } from './components/StatCard';
import { fmtUsd, fmtUsdPrecise } from './format';

function projectMonthly(monthToDate: number, now: Date): number {
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (dayOfMonth === 0) return monthToDate;
  return (monthToDate / dayOfMonth) * daysInMonth;
}

export function CostsTab({ snapshot }: { snapshot: UsageSnapshot }) {
  const { windows, byModel, byProject, daily } = snapshot;
  const now = new Date();
  const projected = projectMonthly(windows.month, now);
  const modelMax = Math.max(1, ...byModel.map((m) => m.cost));
  const projMax = Math.max(1, ...byProject.map((p) => p.cost));

  return (
    <div className="flex flex-col gap-3 pb-10">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard value={fmtUsdPrecise(windows.today)} label="Today" dot="var(--accent)" />
        <StatCard value={fmtUsdPrecise(windows.week)} label="This Week" dot="#4caf6e" />
        <StatCard value={fmtUsd(windows.month)} label="This Month" dot="#d9a443" />
        <StatCard value={fmtUsd(windows.allTime)} label="All Time" dot="#9a7af0" />
      </div>

      <div className="rounded-lg border border-border bg-background-1 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">Cost by model</div>
        {byModel
          .filter((m) => m.cost > 0)
          .map((m) => (
            <BarRow
              key={m.model}
              label={m.model}
              amount={fmtUsd(m.cost)}
              ratio={m.cost / modelMax}
              color="#d9a443"
            />
          ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background-1 p-3">
          <div className="text-sm font-medium text-foreground">Monthly projection</div>
          <div className="mt-2 flex items-end gap-6">
            <div>
              <div className="text-xl font-semibold text-foreground tabular-nums">
                {fmtUsd(projected)}
              </div>
              <div className="text-xs text-foreground-muted">Projected</div>
            </div>
            <div>
              <div className="text-xl font-semibold text-foreground tabular-nums">
                {fmtUsd(windows.month)}
              </div>
              <div className="text-xs text-foreground-muted">So far</div>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-background-1 p-3">
          <div className="mb-2 text-sm font-medium text-foreground">Top projects</div>
          {byProject.map((p) => (
            <BarRow
              key={p.path || p.name}
              label={p.name}
              amount={fmtUsd(p.cost)}
              ratio={p.cost / projMax}
              color="#d9a443"
            />
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background-1 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">Daily cost</div>
        <Sparkline values={daily.map((d) => d.cost)} color="#d9a443" label="cost per day" />
      </div>
    </div>
  );
}
