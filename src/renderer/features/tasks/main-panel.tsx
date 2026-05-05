import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import {
  getTaskStore,
  taskErrorMessage,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { ConversationsPanel } from './conversations/conversations-panel';
import { DiffView } from './diff-view/main-panel/diff-view';
import { EditorMainPanel } from './editor/editor-main-panel';
import { BootstrapPtyView } from './task-bootstrap-pty';
import { TaskBootstrapView } from './task-bootstrap-view';

export const TaskMainPanel = observer(function TaskMainPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  switch (kind) {
    case 'missing':
      return null;
    case 'creating': {
      const step = taskStore?.provisionStep ?? 'creating';
      const message = taskStore?.provisionProgressMessage ?? undefined;
      const ptyView =
        taskStore?.provisionStep === 'running-setup-script' && taskStore.setupSessionId ? (
          <BootstrapPtyView sessionId={taskStore.setupSessionId} message={message ?? 'Running setup script…'} />
        ) : undefined;
      return <TaskBootstrapView step={step} message={message} ptyView={ptyView} />;
    }
    case 'create-error':
      return (
        <TaskBootstrapView
          step="create-error"
          errorTitle="Error creating task"
          errorDetail={taskErrorMessage(taskStore)}
        />
      );
    case 'project-mounting':
      return (
        <TaskBootstrapView
          step="project-mounting"
          message={taskStore?.provisionProgressMessage ?? undefined}
        />
      );
    case 'provisioning': {
      const step = taskStore?.provisionStep ?? 'setting-up-workspace';
      const message = taskStore?.provisionProgressMessage ?? undefined;
      const ptyView =
        taskStore?.provisionStep === 'running-setup-script' && taskStore.setupSessionId ? (
          <BootstrapPtyView sessionId={taskStore.setupSessionId} message={message ?? 'Running setup script…'} />
        ) : undefined;
      return <TaskBootstrapView step={step} message={message} ptyView={ptyView} />;
    }
    case 'provision-error':
    case 'project-error':
      return (
        <TaskBootstrapView
          step="provision-error"
          errorTitle="Failed to set up workspace"
          errorDetail={taskErrorMessage(taskStore)}
        />
      );
    case 'idle':
    case 'teardown':
      return (
        <TaskBootstrapView
          step={kind}
          message={taskStore?.provisionProgressMessage ?? undefined}
        />
      );
    case 'teardown-error':
      return (
        <TaskBootstrapView
          step="teardown-error"
          errorTitle="Failed to tear down workspace"
          errorDetail={taskErrorMessage(taskStore)}
        />
      );
    default:
      return <ReadyTaskMainPanel />;
  }
});

const ReadyTaskMainPanel = observer(function ReadyTaskMainPanel() {
  const { taskView } = useProvisionedTask();

  return (
    <>
      <Activity mode={taskView.view === 'agents' ? 'visible' : 'hidden'}>
        <ConversationsPanel />
      </Activity>
      <Activity mode={taskView.view === 'editor' ? 'visible' : 'hidden'}>
        <EditorMainPanel />
      </Activity>
      <Activity mode={taskView.view === 'diff' ? 'visible' : 'hidden'}>
        <DiffView />
      </Activity>
    </>
  );
});
