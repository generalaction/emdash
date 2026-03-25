import { observer } from 'mobx-react-lite';
import { taskViewStateStore } from '@renderer/core/tasks/view/task-view-store';
import { ChangesPanel } from './diff-viewer/right-panel/changes-panel';
import { EditorFileTree } from './editor/editor-file-tree';
import { useTaskViewContext } from './task-view-context';
import { TerminalsPanel } from './terminals/terminal-panel';

export const TaskRightSidebar = observer(function TaskRightSidebar() {
  const { taskId } = useTaskViewContext();
  const { rightPanelView } = taskViewStateStore.getOrCreate(taskId);

  switch (rightPanelView) {
    case 'changes':
      return <ChangesPanel />;
    case 'files':
      return <EditorFileTree />;
    case 'terminals':
      return <TerminalsPanel />;
  }
});
