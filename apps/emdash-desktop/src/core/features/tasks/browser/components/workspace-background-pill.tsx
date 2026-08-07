import { Spinner, toast, Tooltip } from '@emdash/ui/react/primitives';
import { CloudUpload, TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import {
  asMounted,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { getWorkspaceRegistryWireClient } from '@core/features/workspaces/api/browser/client';
import { projectHostRef } from '@core/primitives/projects/api';
import { cn } from '@core/primitives/styling/browser/cn';

/**
 * Non-blocking indicator for the background half of workspace creation: a subtle
 * "preparing artifacts" state while the ignored-file clone runs, a warning when the
 * clone terminally failed (dependents fall back to a real install), and the "branch
 * not pushed" state with its manual retry action. Never a modal — the agent is
 * already working.
 */
export const WorkspaceBackgroundPill = observer(function WorkspaceBackgroundPill({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId);
  const [isRetrying, setIsRetrying] = useState(false);
  const lifecycle = taskStore?.workspaceLifecycle;
  if (!taskStore || !lifecycle) return null;

  const clone = lifecycle.find((step) => step.id === 'copy-artifacts');
  const push = lifecycle.find((step) => step.id === 'push-branch');

  if (clone?.status === 'pending' || clone?.status === 'running') {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <span className="flex h-7 items-center gap-1.5 rounded-lg bg-background-secondary px-2 text-xs text-foreground-muted">
              <Spinner size="sm" />
              <span className="max-w-32 truncate">Preparing artifacts</span>
            </span>
          }
        />
        <Tooltip.Content>
          Copying build artifacts into the workspace in the background
        </Tooltip.Content>
      </Tooltip.Root>
    );
  }

  if (push?.status === 'failed') {
    const retry = async () => {
      const workspaceId = taskStore.workspaceId;
      const project = asMounted(getProjectStore(projectId));
      if (!workspaceId || !project) return;
      setIsRetrying(true);
      try {
        const client = await getWorkspaceRegistryWireClient();
        const result = await client.retryStep({
          host: projectHostRef(project.data),
          workspaceId,
          step: 'push-branch',
        });
        if (!result.success) {
          throw new Error(
            'message' in result.error ? result.error.message : 'The workspace no longer exists'
          );
        }
      } catch (error) {
        toast.error('Could not push the branch', {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setIsRetrying(false);
      }
    };

    return (
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <button
              type="button"
              disabled={isRetrying}
              onClick={() => void retry()}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors',
                'bg-background-destructive text-foreground-destructive hover:bg-destructive/20'
              )}
            >
              {isRetrying ? <Spinner size="sm" /> : <CloudUpload className="size-3 shrink-0" />}
              <span className="max-w-32 truncate">
                {isRetrying ? 'Pushing…' : 'Branch not pushed'}
              </span>
            </button>
          }
        />
        <Tooltip.Content>
          {push.message ? `Push failed: ${push.message}. ` : 'The branch push failed. '}
          Click to retry.
        </Tooltip.Content>
      </Tooltip.Root>
    );
  }

  if (clone?.status === 'failed') {
    return (
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <span className="flex h-7 items-center gap-1.5 rounded-lg bg-background-secondary px-2 text-xs text-foreground-warning">
              <TriangleAlert className="size-3 shrink-0" />
              <span className="max-w-32 truncate">Artifacts not copied</span>
            </span>
          }
        />
        <Tooltip.Content>
          {clone.message ? `Artifact copy failed: ${clone.message}. ` : 'Artifact copy failed. '}
          Dependencies will be installed from scratch instead.
        </Tooltip.Content>
      </Tooltip.Root>
    );
  }

  return null;
});
