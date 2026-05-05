import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import {
  getTaskStore,
  taskErrorMessage,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { useDebouncedValue } from '@renderer/lib/hooks/use-debounced-value';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import type { TaskStore } from '@renderer/features/tasks/stores/task';
import { ConversationsPanel } from './conversations/conversations-panel';
import { DiffView } from './diff-view/main-panel/diff-view';
import { EditorMainPanel } from './editor/editor-main-panel';
import { BootstrapPtyView, PtySkipButton } from './task-bootstrap-pty';
import { TaskBootstrapView } from './task-bootstrap-view';

const STEP_DEBOUNCE_MS = 500;

export const TaskMainPanel = observer(function TaskMainPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  switch (kind) {
    case 'missing':
      return null;
    case 'creating':
      return <CreatingBootstrap taskStore={taskStore} />;
    case 'create-error':
      return (
        <TaskBootstrapView step="create-error" activeStepStatus="error">
          <p className="text-xs font-mono text-foreground-muted">{taskErrorMessage(taskStore)}</p>
        </TaskBootstrapView>
      );
    case 'project-mounting':
      return <TaskBootstrapView step="project-mounting" />;
    case 'provisioning':
      return <ProvisioningBootstrap taskStore={taskStore} />;
    case 'provision-error':
    case 'project-error':
      return (
        <TaskBootstrapView step="provision-error" activeStepStatus="error">
          <p className="text-xs font-mono text-foreground-muted">{taskErrorMessage(taskStore)}</p>
        </TaskBootstrapView>
      );
    case 'idle':
    case 'teardown':
      return <TaskBootstrapView step={kind} />;
    case 'teardown-error':
      return (
        <TaskBootstrapView step="teardown-error" activeStepStatus="error">
          <p className="text-xs font-mono text-foreground-muted">{taskErrorMessage(taskStore)}</p>
        </TaskBootstrapView>
      );
    default:
      return <ReadyTaskMainPanel />;
  }
});

const CreatingBootstrap = observer(function CreatingBootstrap({
  taskStore,
}: {
  taskStore: TaskStore | undefined;
}) {
  const rawStep = taskStore?.provisionStep ?? 'creating';
  const step = useDebouncedValue(rawStep, STEP_DEBOUNCE_MS);
  const isPtyStep = step === 'running-setup-script' && taskStore?.setupSessionId;

  return (
    <TaskBootstrapView
      step={step}
      actions={isPtyStep ? <PtySkipButton sessionId={taskStore!.setupSessionId!} /> : undefined}
    >
      {isPtyStep ? <BootstrapPtyView sessionId={taskStore!.setupSessionId!} /> : undefined}
    </TaskBootstrapView>
  );
});

const ProvisioningBootstrap = observer(function ProvisioningBootstrap({
  taskStore,
}: {
  taskStore: TaskStore | undefined;
}) {
  const rawStep = taskStore?.provisionStep ?? 'setting-up-workspace';
  const step = useDebouncedValue(rawStep, STEP_DEBOUNCE_MS);
  const isPtyStep = step === 'running-setup-script' && taskStore?.setupSessionId;

  return (
    <TaskBootstrapView
      step={step}
      actions={isPtyStep ? <PtySkipButton sessionId={taskStore!.setupSessionId!} /> : undefined}
    >
      {isPtyStep ? <BootstrapPtyView sessionId={taskStore!.setupSessionId!} /> : undefined}
    </TaskBootstrapView>
  );
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
