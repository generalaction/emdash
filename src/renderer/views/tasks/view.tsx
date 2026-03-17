import type { ReactNode } from 'react';
import type { ViewDefinition } from '@renderer/core/view/registry';
import { TaskViewWrapper } from '@renderer/views/tasks/task-view-context';
import { DiffViewProvider } from './diff-viewer/diff-view-provider';
import { TaskMainPanel } from './main-panel';
import { TaskRightSidebar } from './right-panel';
import { TaskTitlebar } from './task-titlebar';

function TaskViewWrapperWithDiff({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
}) {
  return (
    <TaskViewWrapper projectId={projectId} taskId={taskId}>
      <DiffViewProvider>{children}</DiffViewProvider>
    </TaskViewWrapper>
  );
}

export const taskView = {
  WrapView: TaskViewWrapperWithDiff,
  TitlebarSlot: TaskTitlebar,
  MainPanel: TaskMainPanel,
  RightPanel: TaskRightSidebar,
} satisfies ViewDefinition<{ projectId: string; taskId: string }>;
