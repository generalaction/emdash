import { Loader2 } from 'lucide-react';
import { ConversationsPanel } from './conversations/conversations-panel';
import { DiffView } from './diff-viewer/main-panel/diff-view';
import { EditorMainPanel } from './editor/editor-main-panel';
import { useTaskViewContext } from './task-view-context';

export function TaskMainPanel() {
  const { lifecycleTask } = useTaskViewContext();

  if (lifecycleTask.status === 'creating') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
        <p className="text-xs font-mono text-muted-foreground/50">Creating task</p>
      </div>
    );
  }

  if (lifecycleTask.status === 'create-error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-xs flex-col items-center text-center gap-2">
          <p className="text-sm font-medium font-mono text-destructive">Error creating task</p>
          <p className="text-xs font-mono text-muted-foreground/70">
            {lifecycleTask.error.message}
          </p>
        </div>
      </div>
    );
  }

  if (lifecycleTask.status === 'provisioning') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
        <p className="text-xs font-mono text-muted-foreground/50">Setting up workspace…</p>
      </div>
    );
  }

  if (lifecycleTask.status === 'provision-error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-xs flex-col items-center text-center gap-2">
          <p className="text-sm font-medium font-mono text-destructive">
            Failed to set up workspace
          </p>
          <p className="text-xs font-mono text-muted-foreground/70">
            {lifecycleTask.error.message}
          </p>
        </div>
      </div>
    );
  }

  return <ReadyTaskMainPanel />;
}

function ReadyTaskMainPanel() {
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
