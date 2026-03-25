import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { taskViewStateStore } from '@renderer/core/tasks/view/task-view-store';
import { ConversationsPanel } from './conversations/conversations-panel';
import { DiffView } from './diff-viewer/main-panel/diff-view';
import { EditorMainPanel } from './editor/editor-main-panel';
import { useTaskViewContext } from './task-view-context';
import { getTaskStore, taskErrorMessage, taskViewKind } from './task-view-state';

export const TaskMainPanel = observer(function TaskMainPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const taskStore = getTaskStore(projectId, taskId);
  const kind = taskViewKind(taskStore, projectId);

  if (kind === 'creating') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
        <p className="text-xs font-mono text-muted-foreground/50">Creating task</p>
      </div>
    );
  }

  if (kind === 'create-error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-xs flex-col items-center text-center gap-2">
          <p className="text-sm font-medium font-mono text-destructive">Error creating task</p>
          <p className="text-xs font-mono text-muted-foreground/70">
            {taskErrorMessage(taskStore)}
          </p>
        </div>
      </div>
    );
  }

  if (kind === 'project-mounting' || kind === 'provisioning') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/50" />
        <p className="text-xs font-mono text-muted-foreground/50">Setting up workspace…</p>
      </div>
    );
  }

  if (kind === 'provision-error' || kind === 'project-error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center p-8">
        <div className="flex max-w-xs flex-col items-center text-center gap-2">
          <p className="text-sm font-medium font-mono text-destructive">
            Failed to set up workspace
          </p>
          <p className="text-xs font-mono text-muted-foreground/70">
            {taskErrorMessage(taskStore)}
          </p>
        </div>
      </div>
    );
  }

  return <ReadyTaskMainPanel taskId={taskId} />;
});

const ReadyTaskMainPanel = observer(function ReadyTaskMainPanel({ taskId }: { taskId: string }) {
  const { view } = taskViewStateStore.getOrCreate(taskId);

  switch (view) {
    case 'agents':
      return <ConversationsPanel />;
    case 'editor':
      return <EditorMainPanel />;
    case 'diff':
      return <DiffView />;
  }
});
