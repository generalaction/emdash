import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { projectViewDef } from '@core/features/projects/contributions/views';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
} from '@core/features/tasks/browser/stores/task-selectors';
import { TaskViewWrapper } from '@core/features/tasks/browser/task-view-context';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import { defineViewRuntime } from '@core/primitives/views/react';
import { appState } from '@renderer/lib/stores/app-state';
import { createTaskCommandProvider } from './commands';
import { TaskMainPanel } from './main-panel';
import { TaskTitlebar } from './task-titlebar';

const TaskViewWrapperWithProviders = observer(function TaskViewWrapperWithProviders({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  // Auto-provision when the task view is rendered with an idle task — covers
  // session restore where the task wasn't in openTaskIds, direct navigation,
  // and any other path that lands on the task view before provisioning runs.
  useEffect(() => {
    if (kind !== 'idle') return;
    if (taskStore && 'archivedAt' in taskStore.data && taskStore.data.archivedAt) return;

    getTaskManagerStore(projectId)
      ?.provisionTask(taskId)
      .catch(() => {});
  }, [kind, projectId, taskId, taskStore]);

  if (kind !== 'ready') {
    return (
      <TaskViewWrapper projectId={projectId} taskId={taskId}>
        {children}
      </TaskViewWrapper>
    );
  }

  return (
    <TaskViewWrapper projectId={projectId} taskId={taskId}>
      {children}
    </TaskViewWrapper>
  );
});

export const taskViewRuntime = defineViewRuntime(taskViewDef, {
  slots: {
    wrap: TaskViewWrapperWithProviders,
    titlebar: TaskTitlebar,
    main: TaskMainPanel,
  },
  commandProvider: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
    createTaskCommandProvider(projectId, taskId),
  resolve: ({ projectId, taskId }) => {
    if (
      !appState.projects.projects.has(projectId) &&
      !appState.projects.pendingCreationIds.has(projectId)
    ) {
      return { kind: 'redirect', ref: homeViewDef() };
    }
    const taskManager = getTaskManagerStore(projectId);
    if (taskManager && !taskManager.tasks.has(taskId)) {
      return { kind: 'redirect', ref: projectViewDef({ projectId }) };
    }
    return { kind: 'ok' };
  },
});
