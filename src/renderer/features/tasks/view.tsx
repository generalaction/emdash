import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { ViewDefinition } from '@renderer/app/view-registry';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import {
  ProvisionedTaskProvider,
  TaskViewWrapper,
} from '@renderer/features/tasks/task-view-context';
import { EditorProvider } from './editor/editor-provider';
import { TaskMainPanel } from './main-panel';
import { TaskRightSidebar } from './right-panel';
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
      <ProvisionedTaskProvider projectId={projectId} taskId={taskId}>
        <EditorProvider key={taskId} taskId={taskId} projectId={projectId}>
          {children}
        </EditorProvider>
      </ProvisionedTaskProvider>
    </TaskViewWrapper>
  );
});

export const taskView = {
  WrapView: TaskViewWrapperWithProviders,
  TitlebarSlot: TaskTitlebar,
  MainPanel: TaskMainPanel,
  RightPanel: TaskRightSidebar,
} satisfies ViewDefinition<{ projectId: string; taskId: string }>;
