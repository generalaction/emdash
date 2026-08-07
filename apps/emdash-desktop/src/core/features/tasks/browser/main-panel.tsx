import { Button, Resizable, toast, useResizablePanelRef } from '@emdash/ui/react/primitives';
import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import {
  getTaskManagerStore,
  getTaskStore,
  taskErrorMessage,
  taskViewKind,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { useTaskViewContext } from '@core/features/tasks/api/browser/task-state/task-view-context';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { taskTabView } from '@core/features/workbench/api/browser/task-tab-registry';
import { getWorkspacesWireClient } from '@core/features/workspaces/api/browser/client';
import { TaskMainColumn } from './view/task-main-column';
import { TaskSidebar } from './view/task-sidebar';

/** The task view's shared loading presentation: a centered spinner with an optional label. */
export function TaskViewLoadingState({ label }: { label?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
      {label && <p className="font-sans text-xs text-foreground-muted">{label}</p>}
    </div>
  );
}

export const TaskMainPanel = observer(function TaskMainPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);
  const workspaceId =
    taskStore && 'workspaceId' in taskStore.data ? taskStore.data.workspaceId : undefined;

  if (kind === 'creating') {
    return <TaskViewLoadingState label="Creating task" />;
  }

  if (kind === 'create-error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-xs flex-col items-center gap-2 text-center">
          <p className="font-sans text-sm font-medium text-foreground-destructive">
            Error creating task
          </p>
          <p className="font-sans text-xs text-foreground-passive">{taskErrorMessage(taskStore)}</p>
        </div>
      </div>
    );
  }

  if (kind === 'project-mounting') {
    return <TaskViewLoadingState label="Opening project…" />;
  }

  if (kind === 'provisioning' && taskStore) {
    return <TaskProvisionLoader projectId={projectId} taskId={taskId} taskStore={taskStore} />;
  }

  if (kind === 'provision-error' && taskStore) {
    return (
      <TaskProvisionLoader projectId={projectId} taskId={taskId} taskStore={taskStore} error />
    );
  }

  if (taskStore?.state === 'unprovisioned' && taskStore.workspaceObservedStatus === 'missing') {
    return (
      <MissingWorkspaceState
        reprovision={() => reprovisionWorkspace(projectId, taskId, workspaceId!, false)}
        removeAndReprovision={() => reprovisionWorkspace(projectId, taskId, workspaceId!, true)}
      />
    );
  }

  if (kind === 'project-error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-xs flex-col items-center gap-2 text-center">
          <p className="font-sans text-sm font-medium text-foreground-destructive">
            Failed to set up workspace
          </p>
          <p className="font-sans text-xs text-foreground-muted">{taskErrorMessage(taskStore)}</p>
        </div>
      </div>
    );
  }

  if (kind === 'idle' || kind === 'teardown') {
    return <TaskViewLoadingState label="Setting up workspace…" />;
  }

  if (kind === 'teardown-error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-xs flex-col items-center gap-2 text-center">
          <p className="font-sans text-sm font-medium text-foreground-destructive">
            Failed to tear down workspace
          </p>
          <p className="font-sans text-xs text-foreground-muted">{taskErrorMessage(taskStore)}</p>
        </div>
      </div>
    );
  }

  if (kind === 'missing') {
    return <MissingWorkspaceState />;
  }

  return <ReadyTaskMainPanel />;
});

function MissingWorkspaceState({
  reprovision,
  removeAndReprovision,
}: {
  reprovision?: () => Promise<void>;
  removeAndReprovision?: () => Promise<void>;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-foreground">Workspace is missing</p>
      <p className="max-w-sm text-xs text-foreground-muted">
        Emdash could not activate this workspace. Re-provision it or remove the task.
      </p>
      {reprovision && removeAndReprovision && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => void reprovision()}>
            Re-provision
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void removeAndReprovision()}>
            Remove and re-provision
          </Button>
        </div>
      )}
    </div>
  );
}

async function reprovisionWorkspace(
  projectId: string,
  taskId: string,
  workspaceId: string,
  removeFirst: boolean
): Promise<void> {
  if (
    removeFirst &&
    !window.confirm(
      'Remove this workspace and permanently discard any uncommitted files or changes, then ' +
        're-provision it? This cannot be undone.'
    )
  ) {
    return;
  }
  try {
    const client = await getWorkspacesWireClient();
    const result = removeFirst
      ? await client.removeAndReprovision({ workspaceId })
      : await client.reprovision({ workspaceId });
    if (!result.success) throw new Error(result.error.message);
    await getTaskManagerStore(projectId)?.provisionTask(taskId);
  } catch (error) {
    toast.error('Could not re-provision workspace', {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

const PROVISION_LOADER_DELAY_MS = 300;

/** Human labels for the host createWorktree stages streamed via the records overlay. */
const CREATION_STAGE_LABELS: Record<string, string> = {
  inspect: 'Inspecting the repository',
  fetch: 'Fetching the base branch',
  'add-worktree': 'Creating the worktree',
  verify: 'Verifying the worktree',
  'copy-preserved-files': 'Copying preserved files',
  'push-branch': 'Pushing the branch',
};

const TaskProvisionLoader = observer(function TaskProvisionLoader({
  projectId,
  taskId,
  taskStore,
  error = false,
}: {
  projectId: string;
  taskId: string;
  taskStore: NonNullable<ReturnType<typeof getTaskStore>>;
  error?: boolean;
}) {
  const showLoader = useDelayedVisible(error ? 0 : PROVISION_LOADER_DELAY_MS);
  const errorMessage = taskErrorMessage(taskStore);
  const creation = taskStore.workspaceCreation;
  const failedCreation =
    taskStore.workspaceCreateOutcome?.status === 'failed' ? taskStore.workspaceCreateOutcome : null;

  const retry = () => {
    void getTaskManagerStore(projectId)?.provisionTask(taskId);
  };

  if (!showLoader) {
    return null;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8">
      {!error && <Loader2 className="size-5 animate-spin text-foreground-muted" />}
      <p className="text-sm font-medium text-foreground">
        {error
          ? failedCreation
            ? 'Workspace creation failed'
            : 'Workspace activation failed'
          : creation
            ? 'Creating workspace…'
            : 'Activating workspace…'}
      </p>
      {!error && creation && (
        <p className="text-center font-sans text-xs text-foreground-muted">
          {CREATION_STAGE_LABELS[creation.stage] ?? creation.stage}…
        </p>
      )}
      {error && (
        <p className="text-center font-sans text-xs text-foreground-muted">
          {failedCreation
            ? [
                failedCreation.stage ? `Failed at ${failedCreation.stage}` : null,
                failedCreation.message ?? null,
              ]
                .filter(Boolean)
                .join(': ')
            : errorMessage}
        </p>
      )}
      {error && (
        <Button size="sm" variant="ghost" onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  );
});

function useDelayedVisible(delayMs: number): boolean {
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    if (delayMs === 0) {
      setVisible(true);
      return;
    }

    setVisible(false);
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return visible;
}

const SIDEBAR_COLLAPSED_SIZE = '0px';

const ReadyTaskMainPanel = observer(function ReadyTaskMainPanel() {
  const taskView = useTaskComposition();
  const sidebarPanelRef = useResizablePanelRef();

  useEffect(() => {
    if (taskView.isSidebarCollapsed) {
      sidebarPanelRef.current?.collapse();
    } else {
      sidebarPanelRef.current?.expand();
    }
  }, [taskView.isSidebarCollapsed, sidebarPanelRef]);

  return (
    <taskTabView.TabLayoutProvider layout={taskView.paneLayout}>
      <Resizable.Group orientation="horizontal" id="task-sidebar-layout">
        <Resizable.Panel id="task-main-area">
          <TaskMainColumn />
        </Resizable.Panel>
        <Resizable.Handle />
        <Resizable.Panel
          id="task-sidebar"
          panelRef={sidebarPanelRef}
          defaultSize="25%"
          minSize="280px"
          maxSize="50%"
          collapsible
          collapsedSize={SIDEBAR_COLLAPSED_SIZE}
          onResize={() =>
            taskView.setSidebarCollapsed(sidebarPanelRef.current?.isCollapsed() ?? false)
          }
        >
          <TaskSidebar />
        </Resizable.Panel>
      </Resizable.Group>
    </taskTabView.TabLayoutProvider>
  );
});
