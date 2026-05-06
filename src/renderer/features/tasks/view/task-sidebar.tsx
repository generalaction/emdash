import { ChevronLeft, ChevronRight, FileDiff, FolderOpen, MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { type SidebarTab } from '@renderer/features/tasks/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ChangesPanel } from '../diff-view/changes-panel/changes-panel';
import { EditorFileTree } from '../editor/editor-file-tree';
import { SidebarConversationsList } from './sidebar-conversations-list';
import { cn } from '@renderer/utils/utils';

const TABS: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
  { id: 'conversations', label: 'Conversations', icon: <MessageSquare className="size-4 shrink-0" /> },
  { id: 'changes', label: 'Changes', icon: <FileDiff className="size-4 shrink-0" /> },
  { id: 'files', label: 'Files', icon: <FolderOpen className="size-4 shrink-0" /> },
];

export const TaskSidebar = observer(function TaskSidebar() {
  const { taskView } = useProvisionedTask();
  const { isSidebarCollapsed, sidebarTab: activeTab } = taskView;

  return (
    <div className="flex h-full">
      <TaskSidebarTabs
        activeTab={activeTab}
        onSelect={(tab) => taskView.setSidebarTab(tab)}
        toggleCollapse={() => taskView.setSidebarCollapsed(!isSidebarCollapsed)}
        isCollapsed={isSidebarCollapsed}
      />
      <Activity mode={isSidebarCollapsed ? 'hidden' : 'visible'}>
        <div className="min-h-0 flex-1 overflow-hidden">
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
    </div>
  );
});

function TaskSidebarTabs({
  activeTab,
  onSelect,
  toggleCollapse,
  isCollapsed,
}: {
  activeTab: SidebarTab;
  onSelect: (tab: SidebarTab) => void;
  toggleCollapse: () => void;
  isCollapsed: boolean;
}) {
  return (
    <div className="flex flex-col h-full justify-between border-r">
        <div
        className="flex flex-col items-center p-2 gap-1"
        >
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => onSelect(tab.id)} className={cn(" flex items-center justify-center bg-background-2 p-1 rounded-md", activeTab === tab.id && "text-foreground")}>
              {tab.icon}
            </button>
          ))}
        </div>
      <div className="p-2">
        <Tooltip>
          <TooltipTrigger>
            <button
              onClick={toggleCollapse}
              className=" flex items-center justify-center bg-background-2 p-1 rounded-md"
              aria-label="Collapse sidebar"
            >
              {isCollapsed ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Collapse sidebar</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
