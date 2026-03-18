import type { ReactNode } from 'react';
import type { ViewDefinition } from '@renderer/core/view/registry';
import { TaskViewWrapper } from '@renderer/views/tasks/task-view-context';
import { ActiveFileSync } from './diff-viewer/state/active-file-sync';
import { GitChangesProvider } from './diff-viewer/state/git-changes-provider';
import { GitViewProvider } from './diff-viewer/state/git-view-provider';
import { EditorFiletreeProvider } from './editor/editor-filetree-provider';
import { EditorProvider } from './editor/editor-provider';
import { EditorViewProvider } from './editor/editor-view-provider';
import { TaskMainPanel } from './main-panel';
import { TaskRightSidebar } from './right-panel';
import { TaskTitlebar } from './task-titlebar';

function TaskViewWrapperWithProviders({
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
      <GitViewProvider>
        <GitChangesProvider projectId={projectId} taskId={taskId}>
          <ActiveFileSync />
          <EditorViewProvider>
            <EditorProvider>
              <EditorFiletreeProvider>{children}</EditorFiletreeProvider>
            </EditorProvider>
          </EditorViewProvider>
        </GitChangesProvider>
      </GitViewProvider>
    </TaskViewWrapper>
  );
}

export const taskView = {
  WrapView: TaskViewWrapperWithProviders,
  TitlebarSlot: TaskTitlebar,
  MainPanel: TaskMainPanel,
  RightPanel: TaskRightSidebar,
} satisfies ViewDefinition<{ projectId: string; taskId: string }>;
