import { ConversationsPanel } from './conversations/panel';
import { useCurrentTaskStatus, useTaskViewContext } from './task-view-wrapper';

export function TaskMainPanel() {
  const { status } = useCurrentTaskStatus();
  if (status === 'pending') {
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
