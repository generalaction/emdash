import { observer } from 'mobx-react-lite';
import { type ReactNode } from 'react';
import type { ViewDefinition } from '@renderer/core/view/registry';
import { TaskViewWrapper } from '@renderer/views/tasks/task-view-context';
import { ActiveFileSync } from './diff-viewer/state/active-file-sync';
import { GitViewProvider } from './diff-viewer/state/git-view-provider';
import { PrProvider } from './diff-viewer/state/pr-provider';
import { EditorProvider } from './editor/editor-provider';
import { EditorFiletreeProvider } from './editor/file-tree/filetree-provider';
import { TaskMainPanel } from './main-panel';
import { TaskRightSidebar } from './right-panel';
import { TaskTitlebar } from './task-titlebar';
import { getTaskStore, taskViewKind } from './task-view-state';

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
      <GitViewProvider>
        <PrProvider projectId={projectId} taskId={taskId}>
          <ActiveFileSync />
          <EditorProvider taskId={taskId} projectId={projectId}>
            <EditorFiletreeProvider projectId={projectId} taskId={taskId}>
              {children}
            </EditorFiletreeProvider>
          </EditorProvider>
        </PrProvider>
      </GitViewProvider>
    </TaskViewWrapper>
  );
});

export const taskView = {
  WrapView: TaskViewWrapperWithProviders,
  TitlebarSlot: TaskTitlebar,
  MainPanel: TaskMainPanel,
  RightPanel: TaskRightSidebar,
} satisfies ViewDefinition<{ projectId: string; taskId: string }>;
