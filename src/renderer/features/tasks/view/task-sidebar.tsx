import { ChevronRight, FileDiff, FolderOpen, MessageSquare, PanelLeftClose } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { type SidebarTab } from '@renderer/features/tasks/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { ChangesPanel } from '../diff-view/changes-panel/changes-panel';
import { EditorFileTree } from '../editor/editor-file-tree';
import { SidebarConversationsList } from './sidebar-conversations-list';

const TABS: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
  { id: 'conversations', label: 'Conversations', icon: <MessageSquare className="size-4" /> },
  { id: 'changes', label: 'Changes', icon: <FileDiff className="size-4" /> },
  { id: 'files', label: 'Files', icon: <FolderOpen className="size-4" /> },
];

export const TaskSidebar = observer(function TaskSidebar() {
  const { taskView } = useProvisionedTask();
  const { isSidebarCollapsed, sidebarTab: activeTab } = taskView;

  if (isSidebarCollapsed) {
    return (
      <div className="flex h-full w-8 flex-col items-center border-r bg-background-secondary">
        <div className="mt-auto pb-2">
          <Tooltip>
            <TooltipTrigger>
              <button
                onClick={() => taskView.setSidebarCollapsed(false)}
                className="flex size-7 items-center justify-center rounded-md text-foreground-muted hover:bg-background-1 hover:text-foreground transition-colors"
                aria-label="Expand sidebar"
              >
                <ChevronRight className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-r">
      <div className="flex shrink-0 items-center border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => taskView.setSidebarTab(tab.id)}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 px-1 py-2 text-xs text-foreground-muted hover:text-foreground transition-colors',
              activeTab === tab.id && 'text-foreground border-b-2 border-primary -mb-px'
            )}
            title={tab.label}
          >
            {tab.icon}
            <span className="truncate text-[10px] leading-none">{tab.label}</span>
          </button>
        ))}
        <Tooltip>
          <TooltipTrigger>
            <button
              onClick={() => taskView.setSidebarCollapsed(true)}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground-muted hover:bg-background-1 hover:text-foreground transition-colors mr-1"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Collapse sidebar</TooltipContent>
        </Tooltip>
      </div>
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
    </div>
  );
});
