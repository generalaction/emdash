import { observer } from 'mobx-react-lite';
import { Activity, useEffect, useRef } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import type { TaskStore } from '@renderer/features/tasks/stores/task';
import {
  getTaskStore,
  taskErrorMessage,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useDebouncedValue } from '@renderer/lib/hooks/use-debounced-value';
import { panelDragStore } from '@renderer/lib/layout/panel-drag-store';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { ConversationsPanel } from './conversations/conversations-panel';
import { DiffView } from './diff-view/main-panel/diff-view';
import { EditorMainPanel } from './editor/editor-main-panel';
import { BootstrapPtyView, PtySkipButton } from './task-bootstrap-pty';
import { TaskBootstrapView } from './task-bootstrap-view';
import { TerminalsPanel } from './terminals/terminal-panel';

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
  const bottomPanelRef = usePanelRef();
  const draggingRef = useRef(false);

  useEffect(() => {
    if (taskView.isTerminalDrawerOpen) {
      bottomPanelRef.current?.expand();
    } else {
      bottomPanelRef.current?.collapse();
    }
  }, [taskView.isTerminalDrawerOpen, bottomPanelRef]);

  return (
    <ResizablePanelGroup orientation="vertical" id="task-main-vertical">
      <ResizablePanel id="task-main-content" minSize="30%">
        <div className="flex h-full flex-col">
          <Activity mode={taskView.view === 'agents' ? 'visible' : 'hidden'}>
            <ConversationsPanel />
          </Activity>
          <Activity mode={taskView.view === 'editor' ? 'visible' : 'hidden'}>
            <EditorMainPanel />
          </Activity>
          <Activity mode={taskView.view === 'diff' ? 'visible' : 'hidden'}>
            <DiffView />
          </Activity>
        </div>
      </ResizablePanel>
      <ResizableHandle
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          if (!draggingRef.current) {
            draggingRef.current = true;
            panelDragStore.setDragging(true);
          }
        }}
        onPointerUp={() => {
          if (draggingRef.current) {
            draggingRef.current = false;
            panelDragStore.setDragging(false);
          }
        }}
        onPointerCancel={() => {
          if (draggingRef.current) {
            draggingRef.current = false;
            panelDragStore.setDragging(false);
          }
        }}
        className={taskView.isTerminalDrawerOpen ? 'flex' : 'hidden'}
      />
      <ResizablePanel
        id="task-terminal-drawer"
        panelRef={bottomPanelRef}
        collapsible
        collapsedSize="0%"
        defaultSize="25%"
        minSize="15%"
        onResize={() => taskView.setTerminalDrawerOpen(!bottomPanelRef.current?.isCollapsed())}
      >
        <TerminalsPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
});
