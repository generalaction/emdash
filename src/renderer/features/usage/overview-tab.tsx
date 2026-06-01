import type { UsageSnapshot } from '@shared/usage';
import { ActivityHeatmap } from './components/ActivityHeatmap';
import { BarRow } from './components/BarRow';
import { HourHistogram } from './components/HourHistogram';
import { StatCard } from './components/StatCard';
import { fmtTokens, fmtUsd } from './format';

const PANEL = 'rounded-lg border border-border bg-background-1 p-3';
const HEADING = 'mb-2 text-[10px] font-medium tracking-wider text-foreground/40 uppercase';

export function OverviewTab({ snapshot }: { snapshot: UsageSnapshot }) {
  const { totals, daily, byHour, byModel, byProject, recentSessions } = snapshot;
  const modelMax = Math.max(1, ...byModel.map((m) => m.cost));
  const projMax = Math.max(1, ...byProject.map((p) => p.cost));

  return (
    <div className="flex flex-col gap-3 pb-10">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard value={String(totals.sessions)} label="Sessions" />
        <StatCard value={fmtTokens(totals.messages)} label="Messages" />
        <StatCard value={fmtTokens(totals.tokens)} label="Tokens" />
        <StatCard value={fmtUsd(totals.cost)} label="Est. Cost" />
      </div>

      <div className={PANEL}>
        <ActivityHeatmap daily={daily} />
      </div>

      <div className={PANEL}>
        <div className={HEADING}>When you work</div>
        <HourHistogram byHour={byHour} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className={PANEL}>
          <div className={HEADING}>Cost by model</div>
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
        <div className={PANEL}>
          <div className={HEADING}>Top projects</div>
          {byProject.map((p) => (
            <BarRow
              key={p.path || p.name}
              label={p.name}
              amount={fmtUsd(p.cost)}
              ratio={p.cost / projMax}
            />
          ))}
        </div>
      </div>

      <div className={PANEL}>
        <div className={HEADING}>Recent sessions</div>
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
      </div>
    </div>
  );
}
