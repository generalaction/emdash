import { ChangesPanel } from './diff-viewer/changes-panel/changes-panel';
import { EditorFileTree } from './editor/editor-file-tree';
import { useTaskViewContext } from './task-view-context';
import { TerminalsPanel } from './terminals/panel';

export function TaskRightSidebar() {
  const { rightPanelView } = useTaskViewContext();

  const renderView = () => {
    switch (rightPanelView) {
      case 'changes':
        return <ChangesPanel />;
      case 'files':
        return <EditorFileTree />;
      case 'terminals':
        return <TerminalsPanel />;
    }
  };

  return <div className="flex h-full flex-col">{renderView()}</div>;
}
