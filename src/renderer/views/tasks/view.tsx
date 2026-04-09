import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
} from '@renderer/core/stores/task-selectors';
import type { ViewDefinition } from '@renderer/core/view/registry';
import { ProvisionedTaskProvider, TaskViewWrapper } from '@renderer/views/tasks/task-view-context';
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
  const kind = taskViewKind(getTaskStore(projectId, taskId), projectId);

  // Auto-provision when the task view is rendered with an idle task — covers
  // session restore where the task wasn't in openTaskIds, direct navigation,
  // and any other path that lands on the task view before provisioning runs.
  useEffect(() => {
    if (kind !== 'idle') return;

    getTaskManagerStore(projectId)
      ?.provisionTask(taskId)
      .catch(() => {});
  }, [kind, projectId, taskId]);

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
