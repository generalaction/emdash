import { Loader2 } from 'lucide-react';
import { ConversationsPanel } from './conversations/conversations-panel';
import { DiffView } from './diff-viewer/main-panel/diff-view';
import { EditorMainPanel } from './editor/editor-main-panel';
import { useTaskViewContext } from './task-view-context';

export function TaskMainPanel() {
  const { taskStatus } = useTaskViewContext();

  if (taskStatus.status === 'pending' || taskStatus.status === 'bootstrapping') {
    return <BootstrappingPanel />;
  }

  if (taskStatus.status === 'error') {
    return <BootstrapErrorPanel message={taskStatus.message} />;
  }

  return <ActiveTaskMainPanel />;
}

function BootstrappingPanel() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
      <p className="text-xs font-mono text-muted-foreground/50">Setting up workspace…</p>
    </div>
  );
}

function BootstrapErrorPanel({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center p-8">
      <div className="flex max-w-xs flex-col items-center text-center gap-2">
        <p className="text-sm font-medium font-mono text-destructive">Failed to set up workspace</p>
        <p className="text-xs font-mono text-muted-foreground/70">{message}</p>
      </div>
    </div>
  );
}

function ActiveTaskMainPanel() {
  const { view } = useTaskViewContext();

  switch (view) {
    case 'agents':
      return <ConversationsPanel />;
    case 'editor':
      return <EditorMainPanel />;
    case 'diff':
      return <DiffView />;
  }
}
