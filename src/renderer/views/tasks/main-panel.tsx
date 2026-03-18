import { ConversationsPanel } from './conversations/panel';
import { DiffView } from './diff-viewer/changes-main-panel/diff-view';
import { EditorMainPanel } from './editor/editor-main-panel';
import { useTaskViewContext } from './task-view-context';

export function TaskMainPanel() {
  const { taskStatus } = useTaskViewContext();
  if (taskStatus.status === 'pending') {
    return <PendingTaskMainPanel />;
  }
  return <ActiveTaskMainPanel />;
}

function PendingTaskMainPanel() {
  return <div>Creating task...</div>;
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
