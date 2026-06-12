import type { ReactNode } from 'react';
import { cn } from '@renderer/utils/utils';
import type { ModelUsage, ProjectUsage } from '@shared/usage';
import { fmtTokens, fmtUsd } from '../format';
import { BarRow } from './BarRow';

/** Bordered card used throughout the usage tabs, with an optional section heading. */
export function Panel({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('rounded-lg border border-border bg-background-1 p-3', className)}>
      {title ? (
        <div className="mb-2 text-[10px] font-medium tracking-wider text-foreground/40 uppercase">
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Cost-by-model bar list — identical on the overview and costs tabs. */
export function CostByModel({
  byModel,
  unpricedTokens,
}: {
  byModel: ModelUsage[];
  unpricedTokens: number;
}) {
  const max = Math.max(1, ...byModel.map((m) => m.cost));
  return (
    <Panel title="Cost by model">
      {byModel
        .filter((m) => m.cost > 0 || !m.priced)
        .map((m) => (
          <BarRow
            key={m.model}
            label={m.model}
            amount={m.priced ? fmtUsd(m.cost) : '—'}
            ratio={m.cost / max}
          />
        ))}
      {unpricedTokens > 0 ? (
        <div className="mt-2 text-[10px] text-foreground/40">
          {fmtTokens(unpricedTokens)} tokens from models without known rates are excluded from cost
          totals.
        </div>
      ) : null}
    </Panel>
  );
}

/** Top-projects bar list — identical on the overview and costs tabs. */
export function TopProjects({ byProject }: { byProject: ProjectUsage[] }) {
  const max = Math.max(1, ...byProject.map((p) => p.cost));
  return (
    <Panel title="Top projects">
      {byProject.map((p) => (
        <BarRow
          key={p.path || p.name}
          label={p.name}
          amount={fmtUsd(p.cost)}
          ratio={p.cost / max}
        />
      ))}
    </Panel>
  );
}
