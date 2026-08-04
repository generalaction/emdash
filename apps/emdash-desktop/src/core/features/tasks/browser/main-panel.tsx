import type { OperationDisplayState } from '@emdash/core/primitives/operations/api';
import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import { toast } from 'sonner';
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
import { Button } from '@core/primitives/ui/browser/button';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@core/primitives/ui/browser/resizable';
import { OperationStatusDetails } from '@core/services/operations/browser/operation-trees-panel';
import { useOperationTrees } from '@core/services/operations/browser/use-operation-trees';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { TaskMainColumn } from './view/task-main-column';
import { TaskSidebar } from './view/task-sidebar';

export const TaskMainPanel = observer(function TaskMainPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);
  const getOperationsClient = useCallback(
    async () => (await getDesktopWireClient()).operations,
    []
  );
  const operationTrees = useOperationTrees(projectId, getOperationsClient);
  const workspaceId =
    taskStore && 'workspaceId' in taskStore.data ? taskStore.data.workspaceId : undefined;
  const createOperation = operationTrees.trees
    .flatMap((tree) => [tree.root, ...tree.children])
    .filter(
      (operation) =>
        (operation.operationKind === 'host-create-worktree' ||
          operation.operationKind === 'host-reprovision-worktree') &&
        workspaceId &&
        operation.entityId === workspaceId
    )
    .sort((left, right) => right.createdAt - left.createdAt)[0];

  if (kind === 'creating') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
        <p className="font-sans text-xs text-foreground-muted">Creating task</p>
      </div>
    );
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
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
        <p className="font-sans text-xs text-foreground-muted">Opening project…</p>
      </div>
    );
  }

  if (
    taskStore?.state === 'unprovisioned' &&
    createOperation &&
    createOperation.status !== 'succeeded'
  ) {
    return (
      <TaskWorkspaceOperation
        operation={createOperation}
        retry={() => operationTrees.retry(createOperation.operationId)}
        reprovision={() => reprovisionWorkspace(projectId, taskId, workspaceId!, false)}
        removeAndReprovision={() => reprovisionWorkspace(projectId, taskId, workspaceId!, true)}
      />
    );
  }

  if (kind === 'provisioning' && taskStore) {
    return <TaskProvisionLoader projectId={projectId} taskId={taskId} taskStore={taskStore} />;
  }

  if (kind === 'provision-error' && taskStore) {
    return (
      <TaskProvisionLoader projectId={projectId} taskId={taskId} taskStore={taskStore} error />
    );
  }

  if (
    taskStore?.state === 'unprovisioned' &&
    (taskStore.workspaceObservedStatus === 'missing' ||
      taskStore.workspaceObservedStatus === 'corrupted')
  ) {
    return (
      <MissingWorkspaceState
        status={taskStore.workspaceObservedStatus}
        reason={taskStore.workspaceCorruptionReason}
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
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
        <p className="font-sans text-xs text-foreground-muted">Setting up workspace…</p>
      </div>
    );
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
    return <MissingWorkspaceState status="missing" />;
  }

  return <ReadyTaskMainPanel />;
});

function TaskWorkspaceOperation({
  operation,
  retry,
  reprovision,
  removeAndReprovision,
}: {
  operation: OperationDisplayState;
  retry(): Promise<void>;
  reprovision(): Promise<void>;
  removeAndReprovision(): Promise<void>;
}) {
  const failed = operation.status === 'failed';
  const needsResume =
    operation.status === 'awaiting-confirmation' || operation.status === 'blocked-host-offline';
  const message =
    operation.status === 'queued' || operation.status === 'blocked-host-offline'
      ? 'Workspace creation is queued'
      : failed || needsResume
        ? 'Workspace creation needs attention'
        : 'Creating workspace';
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8">
      <div className="w-full max-w-sm rounded-md border border-border bg-background-secondary/40 p-4">
        <div className="flex items-center gap-2">
          {!failed && !needsResume && (
            <Loader2 className="size-4 animate-spin text-foreground-muted" />
          )}
          <p className="text-sm font-medium text-foreground">{message}</p>
        </div>
        <p className="mt-1 text-xs text-foreground-muted">
          {operation.workspacePath ?? operation.entityName}
        </p>
        <OperationStatusDetails operation={operation} />
        {operation.error && (
          <p className="mt-2 text-xs text-foreground-destructive">{operation.error}</p>
        )}
        {failed && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void reprovision()}>
              Re-provision
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void removeAndReprovision()}>
              Remove and re-provision
            </Button>
          </div>
        )}
        {needsResume && (
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void retry()}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function MissingWorkspaceState({
  status,
  reason,
  reprovision,
  removeAndReprovision,
}: {
  status: 'missing' | 'corrupted';
  reason?: string;
  reprovision?: () => Promise<void>;
  removeAndReprovision?: () => Promise<void>;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-foreground">
        {status === 'corrupted' ? 'Workspace is corrupted' : 'Workspace is missing'}
      </p>
      <p className="max-w-sm text-xs text-foreground-muted">
        Emdash could not activate this workspace. Re-provision it or remove the task.
      </p>
      {reason && <p className="max-w-sm text-xs text-foreground-destructive">{reason}</p>}
      {reprovision && removeAndReprovision && (
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void reprovision()}>
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
    await getTaskManagerStore(projectId)?.provisionTask(taskId, result.data.operationId);
  } catch (error) {
    toast.error('Could not re-provision workspace', {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}

const PROVISION_LOADER_DELAY_MS = 300;

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
        {error ? 'Workspace activation failed' : 'Activating workspace…'}
      </p>
      {error && errorMessage && (
        <p className="text-center font-sans text-xs text-foreground-muted">{errorMessage}</p>
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
  const sidebarPanelRef = usePanelRef();

  useEffect(() => {
    if (taskView.isSidebarCollapsed) {
      sidebarPanelRef.current?.collapse();
    } else {
      sidebarPanelRef.current?.expand();
    }
  }, [taskView.isSidebarCollapsed, sidebarPanelRef]);

  return (
    <taskTabView.TabLayoutProvider layout={taskView.paneLayout}>
      <ResizablePanelGroup orientation="horizontal" id="task-sidebar-layout">
        <ResizablePanel id="task-main-area">
          <TaskMainColumn />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel
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
        </ResizablePanel>
      </ResizablePanelGroup>
    </taskTabView.TabLayoutProvider>
  );
});
