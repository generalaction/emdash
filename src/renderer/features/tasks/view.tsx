import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { type GuardResult, type ViewDefinition } from '@renderer/app/view-registry';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { TaskViewWrapper } from '@renderer/features/tasks/task-view-context';
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

export const taskView = {
  WrapView: TaskViewWrapperWithProviders,
  TitlebarSlot: TaskTitlebar,
  MainPanel: TaskMainPanel,
  commandProvider: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
    createTaskCommandProvider(projectId, taskId),
  canActivate: (params: unknown): GuardResult => {
    const projectId =
      typeof params === 'object' && params !== null
        ? (params as { projectId?: unknown }).projectId
        : undefined;
    const taskId =
      typeof params === 'object' && params !== null
        ? (params as { taskId?: unknown }).taskId
        : undefined;
    if (typeof projectId !== 'string' || typeof taskId !== 'string') {
      return { ok: false, redirect: 'home' };
    }
    if (
      !appState.projects.projects.has(projectId) &&
      !appState.projects.pendingCreationIds.has(projectId)
    ) {
      return { ok: false, redirect: 'home' };
    }
    const taskManager = getTaskManagerStore(projectId);
    if (taskManager && !taskManager.tasks.has(taskId)) {
      return { ok: false, redirect: 'project', params: { projectId } };
    }
    return { ok: true };
  },
} satisfies ViewDefinition<{ projectId: string; taskId: string }>;
