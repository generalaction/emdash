import React, { useCallback, useState } from 'react';
import { Square, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { Spinner } from '../ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import AgentLogo from '../AgentLogo';
import { TaskStatusIndicator } from '../TaskStatusIndicator';
import { agentConfig } from '../../lib/agentConfig';
import { useTaskStatus } from '../../hooks/useTaskStatus';
import { useTaskManagementContext } from '../../contexts/TaskManagementContext';
import { useProjectManagementContext } from '../../contexts/ProjectManagementProvider';
import { TERMINAL_PROVIDER_IDS } from '../../constants/agents';
import { makePtyId } from '@shared/ptyId';
import { formatRelativeTime } from './utils';
import type { Task, TaskMetadata } from '../../types/chat';
import type { Project } from '../../types/app';
import type { Agent } from '../../types';
import type { ProviderId } from '@shared/providers/registry';

/** Returns all tasks across all projects that were created by an automation */
function useAutomationTasks(): Array<{ task: Task; project: Project }> {
  const { tasksByProjectId } = useTaskManagementContext();
  const { projects } = useProjectManagementContext();

  const results: Array<{ task: Task; project: Project }> = [];
  for (const project of projects) {
    const tasks = tasksByProjectId[project.id] ?? [];
    for (const task of tasks) {
      if ((task.metadata as TaskMetadata | undefined)?.automationId) {
        results.push({ task, project });
      }
    }
  }

  // Most recent first
  results.sort(
    (a, b) => new Date(b.task.createdAt ?? 0).getTime() - new Date(a.task.createdAt ?? 0).getTime()
  );

  return results;
}

const AutomationRunningTasks: React.FC = () => {
  const automationTasks = useAutomationTasks();

  if (automationTasks.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
        Automation Tasks
      </h2>
      <div className="space-y-1">
        {automationTasks.map(({ task, project }) => (
          <AutomationTaskRow key={task.id} task={task} project={project} />
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Single task row
// ---------------------------------------------------------------------------

function TaskStatusDisplay({
  status,
  createdAt,
}: {
  status: ReturnType<typeof useTaskStatus>;
  createdAt?: string;
}): React.ReactNode {
  if (status === 'working') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Spinner size="sm" className="h-3 w-3" />
        Working
      </span>
    );
  }
  if (status === 'waiting') {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <TaskStatusIndicator status={status} />
        Waiting
      </span>
    );
  }
  if (status === 'complete') {
    return <span className="text-[11px] text-muted-foreground">Done</span>;
  }
  if (status === 'error') {
    return <span className="text-[11px] text-muted-foreground">Error</span>;
  }
  if (createdAt) {
    return (
      <span className="text-[11px] text-muted-foreground">{formatRelativeTime(createdAt)}</span>
    );
  }
  return null;
}

const AutomationTaskRow: React.FC<{ task: Task; project: Project }> = ({ task, project }) => {
  const status = useTaskStatus(task.id);
  const isWorking = status === 'working';
  const agent = task.agentId ? agentConfig[task.agentId as Agent] : null;
  const { handleDeleteTask, handleSelectTask } = useTaskManagementContext();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleStop = useCallback(() => {
    // Kill all provider PTYs for this task
    for (const providerId of TERMINAL_PROVIDER_IDS) {
      const ptyId = makePtyId(providerId as ProviderId, 'main', task.id);
      try {
        window.electronAPI.ptyKill(ptyId);
      } catch {
        // ignore
      }
    }
  }, [task.id]);

  const handleDelete = useCallback(() => {
    void handleDeleteTask(project, task);
  }, [handleDeleteTask, project, task]);

  const handleNavigate = useCallback(() => {
    handleSelectTask(task);
  }, [handleSelectTask, task]);

  return (
    <div className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted/40">
      {/* Agent icon */}
      {agent?.logo ? (
        <AgentLogo
          logo={agent.logo}
          alt={agent.name}
          isSvg={agent.isSvg}
          invertInDark={agent.invertInDark}
          className="h-4 w-4 shrink-0 rounded-sm"
        />
      ) : (
        <span className="w-4 shrink-0 text-center text-[9px] font-semibold text-muted-foreground">
          {(task.agentId ?? '??').slice(0, 2).toUpperCase()}
        </span>
      )}

      {/* Task name — clickable to navigate */}
      <button
        type="button"
        onClick={handleNavigate}
        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground transition hover:text-foreground/80"
      >
        {task.name}
      </button>

      {/* Status indicator */}
      <div className="flex items-center gap-2">
        <TaskStatusDisplay status={status} createdAt={task.createdAt} />
      </div>

      {/* Actions — visible on hover */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {isWorking && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              handleStop();
            }}
            aria-label="Stop agent"
            className="h-7 w-7"
          >
            <Square className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(e) => {
            e.stopPropagation();
            setShowDeleteConfirm(true);
          }}
          aria-label="Delete task"
          className="h-7 w-7 text-destructive"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              This will permanently delete this automation task and its worktree. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3 sm:gap-3">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AutomationRunningTasks;
