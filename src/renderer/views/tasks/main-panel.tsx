import { ConversationsPanel } from './conversations/panel';
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
  }
}
