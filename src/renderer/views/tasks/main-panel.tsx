import { ConversationsPanel } from './conversations/panel';
import { DiffViewMainPanel } from './diff-viewer/diff-view-main-panel';
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
      return <div>Editor.... </div>;
    case 'diff':
      return <DiffViewMainPanel />;
  }
}
