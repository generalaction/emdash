import { observer } from 'mobx-react-lite';
import { getTaskGitStore } from '@renderer/features/tasks/stores/task-selectors';
import { isRegistered, type TaskStore } from '@renderer/features/tasks/stores/task-store';
import { formatDiffLineCount } from '@renderer/utils/format-diff-line-count';
import { cn } from '@renderer/utils/utils';

export function useTaskGitDiffStats(task: TaskStore): {
  linesAdded: number;
  linesDeleted: number;
  visible: boolean;
} {
  const projectId = isRegistered(task) ? task.data.projectId : undefined;
  const git = projectId ? getTaskGitStore(projectId, task.data.id) : undefined;
  const cachedGit = isRegistered(task) ? task.data.workspaceGit : undefined;
  const linesAdded = git?.totalLinesAdded ?? cachedGit?.linesAdded ?? 0;
  const linesDeleted = git?.totalLinesDeleted ?? cachedGit?.linesDeleted ?? 0;
  const visible =
    (git !== undefined || cachedGit !== undefined) &&
    !git?.error &&
    (linesAdded > 0 || linesDeleted > 0);
  return { linesAdded, linesDeleted, visible };
}

/**
 * Working-tree line add/remove totals for a task.
 * Uses live GitStore data when the task is provisioned; falls back to the
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
  const { linesAdded, linesDeleted, visible } = useTaskGitDiffStats(task);

  if (!visible) return null;

  return (
    <span
      className={cn(
        'shrink-0 tabular-nums leading-none text-muted-foreground flex items-center text-xs',
        className
      )}
      aria-label={`${linesAdded} lines added, ${linesDeleted} lines removed`}
    >
      <span className="inline-block min-w-[3ch] text-right text-foreground-diff-added">
        {linesAdded > 0 ? `+${formatDiffLineCount(linesAdded)}` : null}
      </span>
      <span className="inline-block min-w-[3ch] text-right text-foreground-diff-deleted">
        {linesDeleted > 0 ? `-${formatDiffLineCount(linesDeleted)}` : null}
      </span>
    </span>
  );
});
