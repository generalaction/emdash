import { ChangesList } from './diff-viewer/changes-list';
import { EditorFileTree } from './editor/editor-file-tree';
import { useTaskViewContext } from './task-view-context';
import { TerminalsPanel } from './terminals/panel';

export function TaskRightSidebar() {
  const { rightPanelView, setRightPanelView } = useTaskViewContext();

  const renderView = () => {
    switch (rightPanelView) {
      case 'changes':
        return <ChangesList />;
      case 'files':
        return <EditorFileTree />;
      case 'terminals':
        return <TerminalsPanel />;
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-2 border-b border-border p-2">
        <button onClick={() => setRightPanelView('changes')}>Changes</button>
        <button onClick={() => setRightPanelView('files')}>Files</button>
        <button onClick={() => setRightPanelView('terminals')}>Terminals</button>
      </div>
      <div className="min-h-0 flex-1">{renderView()}</div>
    </div>
  );
}
