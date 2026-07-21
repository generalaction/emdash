import { observer } from 'mobx-react-lite';
import { SidebarConversationsList } from '@core/features/conversations/api/browser/sidebar-conversations-list';
import { EditorFileTree } from '@core/features/editor/api/browser/task-editor/editor-file-tree';
import { ChangesPanel } from '@core/features/source-control/api/browser/diff-view/changes-panel/changes-panel';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { ShowHide } from '@core/primitives/ui/browser/show-hide';

export const TaskSidebar = observer(function TaskSidebar() {
  const taskView = useTaskComposition();
  const { isSidebarCollapsed, sidebarTab: activeTab } = taskView;

  return (
    <div
      className="h-full min-h-0 overflow-hidden"
      style={isSidebarCollapsed ? { display: 'none' } : undefined}
    >
      <ShowHide visible={activeTab === 'conversations'}>
        <SidebarConversationsList />
      </ShowHide>
      <ShowHide visible={taskView.isChangesPanelVisible} lazy>
        <ChangesPanel />
      </ShowHide>
      <ShowHide visible={activeTab === 'files'}>
        <EditorFileTree />
      </ShowHide>
    </div>
  );
});
