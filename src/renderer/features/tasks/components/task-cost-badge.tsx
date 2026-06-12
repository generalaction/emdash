import { fmtTokens, fmtUsdPrecise } from '@renderer/features/usage/format';
import { useUsageSnapshot } from '@renderer/features/usage/use-usage-snapshot';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

/**
 * Estimated AI cost for the work done in this task's worktree. Renders nothing when no
 * usage matches the path (unprovisioned, SSH/remote, or simply no agent activity yet) —
 * an absent badge is clearer than a "$0.00" that reads as "free".
 */
export function TaskCostBadge({ workspacePath }: { workspacePath: string }) {
  const { snapshot } = useUsageSnapshot();
  if (!workspacePath) return null;
  const row = snapshot.byCwd.find((c) => c.cwd === workspacePath);
  if (!row || row.cost <= 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex items-center rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground-muted tabular-nums">
            {fmtUsdPrecise(row.cost)}
          </span>
        }
      />
      <TooltipContent>
        Estimated AI cost in this task&apos;s worktree · {fmtTokens(row.tokens)} tokens
      </TooltipContent>
    </Tooltip>
  );
}
