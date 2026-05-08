import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { ChangesPanel } from '../diff-view/changes-panel/changes-panel';
import { EditorFileTree } from '../editor/editor-file-tree';
import { SidebarConversationsList } from './sidebar-conversations-list';

export const TaskSidebar = observer(function TaskSidebar() {
  const { taskView } = useProvisionedTask();
  const { isSidebarCollapsed, sidebarTab: activeTab } = taskView;

  return (
    <Activity mode={isSidebarCollapsed ? 'hidden' : 'visible'}>
      <div className="min-h-0 h-full overflow-hidden">
        <Activity mode={activeTab === 'conversations' ? 'visible' : 'hidden'}>
          <SidebarConversationsList />
        </Activity>
        <Activity mode={activeTab === 'changes' ? 'visible' : 'hidden'}>
          <ChangesPanel />
        </Activity>
        <Activity mode={activeTab === 'files' ? 'visible' : 'hidden'}>
          <EditorFileTree />
        </Activity>
      </div>
    </Activity>
  );
});
