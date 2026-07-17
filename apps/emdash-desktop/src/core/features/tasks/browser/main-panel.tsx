import { SteppedLoader } from '@emdash/ui/react/components';
import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import {
  getTaskManagerStore,
  getTaskStore,
  taskErrorMessage,
  taskViewKind,
} from '@core/features/tasks/browser/stores/task-selectors';
import {
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@core/features/tasks/browser/task-view-context';
import { taskTabView } from '@core/features/workbench/browser/task-tab-registry';
import type { WorkspaceBootstrapProgress } from '@core/features/workspaces/api';
import { bootstrapProgressToSteppedLoader } from '@renderer/lib/provisioning/bootstrap-stepped-loader';
import { Button } from '@renderer/lib/ui/button';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { TaskMainColumn } from './view/task-main-column';
import { TaskSidebar } from './view/task-sidebar';

export const TaskMainPanel = observer(function TaskMainPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

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
    const progressMessage = taskStore?.provisionProgressMessage ?? 'Setting up workspace…';
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
        <p className="font-sans text-xs text-foreground-muted">{progressMessage}</p>
      </div>
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
    const progressMessage = taskStore?.provisionProgressMessage ?? 'Setting up workspace…';
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
        <p className="font-sans text-xs text-foreground-muted">{progressMessage}</p>
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
    return null;
  }

  return <ReadyTaskMainPanel />;
});

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
  const progress = taskStore.provisionProgress ?? fallbackProvisionProgress(taskStore);
  const model = bootstrapProgressToSteppedLoader(progress, taskStore.provisionError);
  const errorMessage = taskErrorMessage(taskStore);

  const retry = () => {
    void getTaskManagerStore(projectId)?.provisionTask(taskId);
  };

  if (!showLoader) {
    return null;
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8">
      <div className="flex h-64 w-full max-w-sm min-w-0">
        <SteppedLoader
          className="flex-1"
          steps={model.steps}
          activeStepId={model.activeStepId}
          status={error ? 'error' : model.status}
          actions={
            error ? (
              <Button size="sm" variant="ghost" onClick={retry}>
                Retry
              </Button>
            ) : undefined
          }
        />
      </div>
      {error && errorMessage && (
        <p className="text-center font-sans text-xs text-foreground-muted">{errorMessage}</p>
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

function fallbackProvisionProgress(
  taskStore: NonNullable<ReturnType<typeof getTaskStore>>
): WorkspaceBootstrapProgress {
  return {
    step: 'setting-up-workspace',
    message: taskStore.provisionProgressMessage ?? 'Setting up workspace…',
  };
}

const SIDEBAR_COLLAPSED_SIZE = '0px';

const ReadyTaskMainPanel = observer(function ReadyTaskMainPanel() {
  const taskView = useWorkspaceViewModel();
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
