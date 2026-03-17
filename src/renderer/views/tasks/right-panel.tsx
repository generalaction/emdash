import { useTaskViewContext } from './task-view-context';

export function TaskRightSidebar() {
  const { view } = useTaskViewContext();

  switch (view) {
    case 'agents':
      return <div>Changes etc.</div>;
    case 'editor':
      return <div>FileTree</div>;
  }
}
