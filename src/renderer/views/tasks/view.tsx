import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import {
  getTaskManagerStore,
  getTaskStore,
  taskViewKind,
} from '@renderer/core/stores/task-selectors';
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
  const kind = taskViewKind(getTaskStore(projectId, taskId), projectId);

  // #region agent log
  useEffect(() => {
    fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
      body: JSON.stringify({
        sessionId: 'f1d8e3',
        location: 'view.tsx:task-kind',
        message: 'TaskViewWrapperWithProviders kind changed',
        data: { kind, projectId, taskId },
        timestamp: Date.now(),
        runId: 'run2',
        hypothesisId: 'E',
      }),
    }).catch(() => {});
  }, [kind, projectId, taskId]);
  // #endregion

  // Auto-provision when the task view is rendered with an idle task — covers
  // session restore where the task wasn't in openTaskIds, direct navigation,
  // and any other path that lands on the task view before provisioning runs.
  useEffect(() => {
    if (kind !== 'idle') return;
    // #region agent log
    fetch('http://127.0.0.1:7430/ingest/6ccbb4c2-4905-4756-889f-988f583bdf2f', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'f1d8e3' },
      body: JSON.stringify({
        sessionId: 'f1d8e3',
        location: 'view.tsx:auto-provision',
        message: 'auto-provision triggered',
        data: { projectId, taskId },
        timestamp: Date.now(),
        runId: 'run2',
        hypothesisId: 'E',
      }),
    }).catch(() => {});
    // #endregion
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
