import { observer } from 'mobx-react-lite';
import { type ReactNode } from 'react';
import { getTaskStore, taskViewKind } from '@renderer/core/stores/task-selectors';
import type { ViewDefinition } from '@renderer/core/view/registry';
import { TaskViewWrapper } from '@renderer/views/tasks/task-view-context';
import { PrProvider } from './diff-viewer/state/pr-provider';
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
  const isReady = taskViewKind(getTaskStore(projectId, taskId), projectId) === 'ready';

  if (!isReady) {
    return (
      <TaskViewWrapper projectId={projectId} taskId={taskId}>
        {children}
      </TaskViewWrapper>
    );
  }

  return (
    <TaskViewWrapper projectId={projectId} taskId={taskId}>
      <PrProvider projectId={projectId} taskId={taskId}>
        <EditorProvider key={taskId} taskId={taskId} projectId={projectId}>
          {children}
        </EditorProvider>
      </PrProvider>
    </TaskViewWrapper>
  );
});

export const taskView = {
  WrapView: TaskViewWrapperWithProviders,
  TitlebarSlot: TaskTitlebar,
  MainPanel: TaskMainPanel,
  RightPanel: TaskRightSidebar,
} satisfies ViewDefinition<{ projectId: string; taskId: string }>;
