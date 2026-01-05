import React from 'react';
import { GitBranch, ArrowUpRight, AlertCircle } from 'lucide-react';
import TaskDeleteButton from './TaskDeleteButton';
import { useTaskChanges } from '../hooks/useTaskChanges';
import { ChangesBadge } from './TaskChanges';
import { Spinner } from './ui/spinner';
import { usePrStatus } from '../hooks/usePrStatus';
import { useTaskBusy } from '../hooks/useTaskBusy';
import PrPreviewTooltip from './PrPreviewTooltip';

interface Task {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  agentId?: string;
  useWorktree?: boolean;
}

interface TaskItemProps {
  task: Task;
  onDelete?: () => void | Promise<void | boolean>;
  showDelete?: boolean;
  showDirectBadge?: boolean;
}

export const TaskItem: React.FC<TaskItemProps> = ({
  task,
  onDelete,
  showDelete,
  showDirectBadge = true,
}) => {
  const { totalAdditions, totalDeletions, isLoading } = useTaskChanges(task.path, task.id);
  const { pr } = usePrStatus(task.path);
  const isRunning = useTaskBusy(task.id);

  const [isDeleting, setIsDeleting] = React.useState(false);

  return (
    <div className="flex min-w-0 items-center justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
        {isRunning || task.status === 'running' ? (
          <Spinner size="sm" className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <GitBranch className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        )}
        <span className="block truncate text-xs font-medium text-foreground">{task.name}</span>
        {showDirectBadge && task.useWorktree === false && (
          <span
            className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground"
            title="Running directly on branch (no worktree isolation)"
          >
            <AlertCircle className="h-2.5 w-2.5" />
            Direct
          </span>
        )}
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        {showDelete && onDelete ? (
          <TaskDeleteButton
            taskName={task.name}
            taskId={task.id}
            taskPath={task.path}
            onConfirm={async () => {
              try {
                setIsDeleting(true);
                await onDelete();
              } finally {
                setIsDeleting(false);
              }
            }}
            isDeleting={isDeleting}
            aria-label={`Delete Task ${task.name}`}
            className={`text-muted-foreground ${
              isDeleting ? '' : 'opacity-0 group-hover/task:opacity-100'
            }`}
          />
        ) : null}
        <div aria-hidden={isLoading ? 'true' : 'false'}>
          {!isLoading && (totalAdditions > 0 || totalDeletions > 0) ? (
            <ChangesBadge additions={totalAdditions} deletions={totalDeletions} />
          ) : pr ? (
            <PrPreviewTooltip pr={pr} side="top">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (pr.url) window.electronAPI.openExternal(pr.url);
                }}
                className="inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                title={`${pr.title || 'Pull Request'} (#${pr.number})`}
              >
                {pr.isDraft
                  ? 'Draft'
                  : String(pr.state).toUpperCase() === 'OPEN'
                    ? 'View PR'
                    : `PR ${String(pr.state).charAt(0).toUpperCase() + String(pr.state).slice(1).toLowerCase()}`}
                <ArrowUpRight className="size-3" />
              </button>
            </PrPreviewTooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
};
