import { ChevronLeft, ChevronRight, FileDiff, FolderOpen, MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity, type ButtonHTMLAttributes } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { type SidebarTab } from '@renderer/features/tasks/types';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { ChangesPanel } from '../diff-view/changes-panel/changes-panel';
import { EditorFileTree } from '../editor/editor-file-tree';
import { SidebarConversationsList } from './sidebar-conversations-list';

const TABS: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'conversations',
    label: 'Conversations',
    icon: <MessageSquare className="size-4 shrink-0" />,
  },
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
        onSelect={(tab) => {
          if (tab === activeTab && !isSidebarCollapsed) {
            taskView.setSidebarCollapsed(true);
          } else {
            taskView.setSidebarTab(tab);
            taskView.setSidebarCollapsed(false);
          }
        }}
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

function TaskSidebarButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        ' flex items-center text-foreground-muted justify-center p-1 rounded-md hover:bg-background-1 hover:text-foreground transition-colors',
        props.className
      )}
    >
      {props.children}
    </button>
  );
}

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
      <div className="flex flex-col items-center p-2 gap-1">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <TaskSidebarButton
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              className={cn(
                isActive && 'text-foreground bg-background-3 hover:bg-background-3',
                isActive &&
                  isCollapsed &&
                  'text-foreground-muted bg-background-2 hover:bg-background-2'
              )}
            >
              {tab.icon}
            </TaskSidebarButton>
          );
        })}
      </div>
      <div className="p-2">
        <Tooltip>
          <TooltipTrigger>
            <TaskSidebarButton onClick={toggleCollapse} aria-label="Collapse sidebar">
              {isCollapsed ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </TaskSidebarButton>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            Collapse sidebar <ShortcutHint settingsKey="toggleRightSidebar" />
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
