import { observer } from 'mobx-react-lite';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { ChangesPanel } from './diff-viewer/right-panel/changes-panel';
import { EditorFileTree } from './editor/editor-file-tree';
import { useTaskViewContext } from './task-view-context';
import { TerminalsPanel } from './terminals/terminal-panel';

export const TaskRightSidebar = observer(function TaskRightSidebar() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return null;
  const { rightPanelView } = provisioned;

  switch (rightPanelView) {
    case 'changes':
      return <ChangesPanel />;
    case 'files':
      return <EditorFileTree />;
    case 'terminals':
      return <TerminalsPanel />;
  }
});
