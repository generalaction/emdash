import { observer } from 'mobx-react-lite';
import { getTaskGitCheckoutStore } from '@core/features/source-control/api/browser/stores/task-source-control-selectors';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { formatDiffLineCount } from '@core/primitives/formatting/browser/format-diff-line-count';
import { cn } from '@core/primitives/styling/browser/cn';
import { isRegistered } from '@core/primitives/task-state/browser/task-state';

export function useTaskGitDiffStats(task: TaskStore): {
  linesAdded: number;
  linesDeleted: number;
  visible: boolean;
  freshness: 'fresh' | 'stale' | 'unavailable';
} {
  const projectId = isRegistered(task) ? task.data.projectId : undefined;
  const observation = projectId ? getTaskManagerStore(projectId)?.taskStatsObservation : undefined;
  const git = projectId ? getTaskGitCheckoutStore(projectId, task.data.id) : undefined;
  const cachedGit = isRegistered(task) ? task.data.workspaceGit : undefined;
  const linesAdded = git?.totalLinesAdded ?? cachedGit?.linesAdded ?? 0;
  const linesDeleted = git?.totalLinesDeleted ?? cachedGit?.linesDeleted ?? 0;
  const hasObservedCachedGit =
    (observation?.kind === 'fresh' || observation?.kind === 'stale') && cachedGit !== undefined;
  const visible =
    (git !== undefined || hasObservedCachedGit) &&
    !git?.error &&
    (linesAdded > 0 || linesDeleted > 0);
  return {
    linesAdded,
    linesDeleted,
    visible,
    freshness: observation?.kind ?? 'unavailable',
  };
}

/**
 * Working-tree line add/remove totals for a task.
 * Uses live GitCheckoutStore data when the task is provisioned; falls back to the
 * cached workspaceGit snapshot (stored in SQLite) for unprovisioned tasks.
 * Renders nothing when loading, in error, or clean.
 */
export const TaskGitDiffStats = observer(function TaskGitDiffStats({
  task,
  className,
}: {
  task: TaskStore;
  className?: string;
}) {
  const { linesAdded, linesDeleted, visible, freshness } = useTaskGitDiffStats(task);

  if (!visible) return null;

  return (
    <span
      className={cn(
        'shrink-0 tabular-nums leading-none text-muted-foreground flex items-center gap-1 text-xs',
        className
      )}
      aria-label={[
        linesAdded > 0 ? `${linesAdded} lines added` : null,
        linesDeleted > 0 ? `${linesDeleted} lines removed` : null,
        freshness === 'stale' ? 'last observed while Project access was available' : null,
      ]
        .filter(Boolean)
        .join(', ')}
    >
      {linesAdded > 0 ? (
        <span className="text-foreground-diff-added">+{formatDiffLineCount(linesAdded)}</span>
      ) : null}
      {linesDeleted > 0 ? (
        <span className="text-foreground-diff-deleted">-{formatDiffLineCount(linesDeleted)}</span>
      ) : null}
    </span>
  );
});
