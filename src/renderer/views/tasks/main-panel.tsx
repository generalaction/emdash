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
      return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">Agentss</div>;
    case 'editor':
      return <div>Editor.... </div>;
  }
}
