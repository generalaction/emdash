import type { UsageSnapshot } from '@shared/usage';
import { BarRow } from './components/BarRow';
import { DedupBadge } from './components/DedupBadge';
import { HourHistogram } from './components/HourHistogram';
import { Sparkline } from './components/Sparkline';
import { StatCard } from './components/StatCard';
import { fmtTokens, fmtUsd } from './format';

export function OverviewTab({ snapshot }: { snapshot: UsageSnapshot }) {
  const { totals, daily, byHour, byModel, byProject, recentSessions } = snapshot;
  const modelMax = Math.max(1, ...byModel.map((m) => m.cost));
  const projMax = Math.max(1, ...byProject.map((p) => p.cost));

  return (
    <div className="flex flex-col gap-3 pb-10">
      <div className="flex items-center justify-between">
        <div className="text-sm text-foreground-muted">Across Claude Code &amp; Codex</div>
        <DedupBadge />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard value={String(totals.sessions)} label="Sessions" dot="var(--accent)" />
        <StatCard value={fmtTokens(totals.messages)} label="Messages" dot="#4caf6e" />
        <StatCard value={fmtTokens(totals.tokens)} label="Tokens" dot="#d9a443" />
        <StatCard value={fmtUsd(totals.cost)} label="Est. Cost" dot="#9a7af0" />
      </div>

      <div className="rounded-lg border border-border bg-background-1 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">Activity</div>
        <Sparkline values={daily.map((d) => d.tokens)} label="tokens per day" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-background-1 p-3">
          <div className="mb-2 text-sm font-medium text-foreground">When you work</div>
          <HourHistogram byHour={byHour} />
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
              />
            ))}
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
          />
        ))}
      </div>

      <div className="rounded-lg border border-border bg-background-1 p-3">
        <div className="mb-2 text-sm font-medium text-foreground">Recent sessions</div>
        {recentSessions.map((s) => (
          <div
            key={s.id}
            className="flex items-center justify-between border-t border-border/50 py-1.5 text-sm first:border-t-0"
          >
            <span className="truncate text-foreground-muted">{s.name}</span>
            <span className="shrink-0 pl-2 text-xs text-foreground-muted">
              {s.model ?? s.provider}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
