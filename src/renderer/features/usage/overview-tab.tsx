import type { UsageSnapshot } from '@shared/usage';
import { ActivityHeatmap } from './components/ActivityHeatmap';
import { HourHistogram } from './components/HourHistogram';
import { CostByModel, Panel, TopProjects } from './components/Panel';
import { StatCard } from './components/StatCard';
import { fmtTokens, fmtUsd } from './format';

export function OverviewTab({ snapshot }: { snapshot: UsageSnapshot }) {
  const { totals, daily, byHour, byModel, byProject, recentSessions } = snapshot;

  return (
    <div className="flex flex-col gap-3 pb-10">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard value={String(totals.sessions)} label="Sessions" />
        <StatCard value={fmtTokens(totals.messages)} label="Messages" />
        <StatCard
          value={fmtTokens(totals.tokens)}
          label="Tokens"
          hint="Each API response is counted once — when you resume or fork a session, the copied earlier messages aren't counted again, so totals run lower (and truer) than tools that count every transcript line."
        />
        <StatCard value={fmtUsd(totals.cost)} label="Est. Cost" />
      </div>

      <Panel>
        <ActivityHeatmap daily={daily} />
      </Panel>

      <Panel title="When you work">
        <HourHistogram byHour={byHour} />
      </Panel>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CostByModel byModel={byModel} unpricedTokens={totals.unpricedTokens} />
        <TopProjects byProject={byProject} />
      </div>

      <Panel title="Recent sessions">
        {recentSessions.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between border-t border-border/50 py-1.5 text-sm first:border-t-0"
          >
            <span className="truncate text-foreground-muted">{s.name}</span>
            <span className="shrink-0 pl-2 text-xs text-foreground/40">
              {s.model ?? s.provider}
            </span>
          </div>
        ))}
      </Panel>
    </div>
  );
}
