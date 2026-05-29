import { observer } from 'mobx-react-lite';
import { getTaskStore } from '@renderer/features/tasks/stores/task-selectors';
import { taskViewProfileForStore } from '@renderer/features/tasks/stores/task-store';
import {
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { ShowHide } from '@renderer/lib/ui/show-hide';
import { TASK_SIDEBAR_GROUP } from '@shared/tasks';
import { SidebarConversationsList } from '../conversations/sidebar-conversations-list';
import { ChangesPanel } from '../diff-view/changes-panel/changes-panel';
import { EditorFileTree } from '../editor/editor-file-tree';

export const TaskSidebar = observer(function TaskSidebar() {
  const { projectId, taskId } = useTaskViewContext();
  const taskView = useWorkspaceViewModel();
  const { isSidebarCollapsed, sidebarTab: activeTab } = taskView;
  const taskStore = getTaskStore(projectId, taskId);
  const viewProfile = taskStore ? taskViewProfileForStore(taskStore) : null;

  return (
    <div
      className="h-full min-h-0 overflow-hidden"
      style={isSidebarCollapsed ? { display: 'none' } : undefined}
    >
      <ShowHide
        visible={activeTab === 'conversations' || viewProfile?.group === TASK_SIDEBAR_GROUP.Chats}
      >
        <SidebarConversationsList />
      </ShowHide>
      {viewProfile?.showChangesSidebar && (
        <ShowHide visible={!isSidebarCollapsed && activeTab === 'changes'} lazy>
          <ChangesPanel />
        </ShowHide>
      )}
      {viewProfile?.showFilesSidebar && (
        <ShowHide visible={activeTab === 'files'}>
          <EditorFileTree />
        </ShowHide>
      )}
    </div>
  );
});
