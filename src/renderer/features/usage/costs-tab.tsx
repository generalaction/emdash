import type { UsageSnapshot } from '@shared/usage';
import { CostByModel, Panel, TopProjects } from './components/Panel';
import { Sparkline } from './components/Sparkline';
import { StatCard } from './components/StatCard';
import { fmtUsd, fmtUsdPrecise } from './format';

function projectMonthly(monthToDate: number, now: Date): number {
  const dayOfMonth = now.getDate(); // 1–31
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return (monthToDate / dayOfMonth) * daysInMonth;
}

export function CostsTab({ snapshot }: { snapshot: UsageSnapshot }) {
  const { windows, byModel, byProject, daily } = snapshot;
  const projected = projectMonthly(windows.month, new Date());

  return (
    <div className="flex flex-col gap-3 pb-10">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard value={fmtUsdPrecise(windows.today)} label="Today" />
        <StatCard value={fmtUsdPrecise(windows.week)} label="This Week" />
        <StatCard value={fmtUsd(windows.month)} label="This Month" />
        <StatCard value={fmtUsd(windows.allTime)} label="All Time" />
      </div>

      <CostByModel byModel={byModel} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Panel title="Monthly projection">
          <div className="mt-1 flex items-end gap-6">
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
        </Panel>
        <TopProjects byProject={byProject} />
      </div>

      <Panel title="Daily cost">
        <Sparkline values={daily.map((d) => d.cost)} label="cost per day" />
      </Panel>
    </div>
  );
}
