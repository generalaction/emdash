import { Loader2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity, useCallback, useEffect, useMemo, useState } from 'react';
import {
  getTaskStore,
  taskErrorMessage,
  taskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { PtyPane } from '@renderer/lib/pty/pty-pane';
import { PtySession } from '@renderer/lib/pty/pty-session';
import { ConversationsPanel } from './conversations/conversations-panel';
import { DiffView } from './diff-view/main-panel/diff-view';
import { EditorMainPanel } from './editor/editor-main-panel';

function BootstrapSpinner({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
      <p className="text-xs font-mono text-foreground-muted">{message}</p>
    </div>
  );
}

function BootstrapError({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-xs flex-col items-center text-center gap-2">
        <p className="text-sm font-medium font-mono text-foreground-destructive">{title}</p>
        {detail && <p className="text-xs font-mono text-foreground-muted">{detail}</p>}
      </div>
    </div>
  );
}

const BootstrapPtyView = observer(function BootstrapPtyView({
  sessionId,
  message,
}: {
  sessionId: string;
  message: string;
}) {
  const session = useMemo(() => new PtySession(sessionId), [sessionId]);
  const [isSkipping, setIsSkipping] = useState(false);

  useEffect(() => {
    void session.connect();
    return () => session.dispose();
  }, [session]);

  const handleSkip = useCallback(() => {
    setIsSkipping(true);
    void rpc.pty.kill(sessionId).catch(() => {
      setIsSkipping(false);
    });
  }, [sessionId]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-muted" />
        <p className="flex-1 text-xs font-mono text-foreground-muted">{message}</p>
        <button
          onClick={handleSkip}
          disabled={isSkipping}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground-muted transition-colors hover:bg-background-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <X className="h-3 w-3" />
          Skip
        </button>
      </div>
      {session.status === 'ready' && session.pty ? (
        <PtyPane sessionId={sessionId} pty={session.pty} className="h-full w-full" />
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
});

export const TaskMainPanel = observer(function TaskMainPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  switch (kind) {
    case 'missing':
      return null;
    case 'creating': {
      const message = taskStore?.provisionProgressMessage ?? 'Creating task…';
      return taskStore?.provisionStep === 'running-setup-script' && taskStore.setupSessionId ? (
        <BootstrapPtyView sessionId={taskStore.setupSessionId} message={message} />
      ) : (
        <BootstrapSpinner message={message} />
      );
    }
    case 'create-error':
      return <BootstrapError title="Error creating task" detail={taskErrorMessage(taskStore)} />;
    case 'project-mounting':
      return (
        <BootstrapSpinner
          message={taskStore?.provisionProgressMessage ?? 'Opening project…'}
        />
      );
    case 'provisioning': {
      const message = taskStore?.provisionProgressMessage ?? 'Setting up workspace…';
      return taskStore?.provisionStep === 'running-setup-script' && taskStore.setupSessionId ? (
        <BootstrapPtyView sessionId={taskStore.setupSessionId} message={message} />
      ) : (
        <BootstrapSpinner message={message} />
      );
    }
    case 'provision-error':
    case 'project-error':
      return (
        <BootstrapError
          title="Failed to set up workspace"
          detail={taskErrorMessage(taskStore)}
        />
      );
    case 'idle':
    case 'teardown':
      return (
        <BootstrapSpinner
          message={taskStore?.provisionProgressMessage ?? 'Setting up workspace…'}
        />
      );
    case 'teardown-error':
      return (
        <BootstrapError
          title="Failed to tear down workspace"
          detail={taskErrorMessage(taskStore)}
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
