import { FolderPlus, MessageSquareShare, Plug, Puzzle, Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import { useGithubContext } from '@renderer/core/github-context-provider';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { appState } from '@renderer/core/stores/app-state';
import {
  isCurrentView,
  useNavigate,
  useWorkspaceSlots,
} from '@renderer/core/view/navigation-provider';
import { MicroLabel } from '../ui/label';
import ShortcutHint from '../ui/shortcut-hint';
import { SidebarPinnedTaskList } from './pinned-task-list';
import { ProjectsGroupLabel } from './projects-group-label';
import {
  SidebarContainer,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
} from './sidebar-primitives';
import { SidebarSpace } from './sidebar-space';
import { SidebarVirtualList } from './sidebar-virtual-list';

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const appVersion = appState.appInfo.info.data?.appVersion;
  const { user: githubUser } = useGithubContext();

  const showAddProjectModal = useShowModal('addProjectModal');
  const showFeedbackModal = useShowModal('feedbackModal');

  return (
    <div className="flex flex-col h-full bg-background-tertiary text-foreground-tertiary-muted">
      <SidebarSpace />
      <SidebarContainer className="w-full border-r-0 flex-1 min-h-0">
        <SidebarContent className="flex flex-col">
          <SidebarPinnedTaskList />
          <SidebarGroup className="mb-0 min-h-0 flex-1 flex flex-col">
            <ProjectsGroupLabel />
            <SidebarGroupContent className="min-h-0 flex-1 flex flex-col">
              <SidebarMenu className="flex-1 min-h-0 flex flex-col">
                <SidebarVirtualList />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuButton
              isActive={false}
              onClick={() => showAddProjectModal({})}
              aria-label="Add Project"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2 min-w-0 w-full">
                <FolderPlus className="h-5 w-5 sm:h-4 sm:w-4 shrink-0" />
                <span className="truncate min-w-0">Add Project</span>
              </span>
              <ShortcutHint settingsKey="newProject" />
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'skills')}
              onClick={() => navigate('skills')}
              aria-label="Skills"
              className="w-full justify-start"
            >
              <Puzzle className="h-5 w-5 sm:h-4 sm:w-4" />
              Skills
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'mcp')}
              onClick={() => navigate('mcp')}
              aria-label="MCP"
              className="w-full justify-start"
            >
              <Plug className="h-5 w-5 sm:h-4 sm:w-4" />
              MCP
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'settings')}
              onClick={() => navigate('settings')}
              aria-label="Settings"
              className="w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <Settings className="h-5 w-5 sm:h-4 sm:w-4" />
                Settings
              </span>
              <ShortcutHint settingsKey="settings" />
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarFooter>
        <div className="flex items-center gap-2 justify-between px-3 py-2 border-t border-border">
          <button
            className="flex items-center min-w-0 w-full gap-2 text-sm text-foreground-muted hover:text-foreground px-3 py-1.5 rounded-md hover:bg-background-tertiary-1"
            onClick={() => showFeedbackModal({ githubUser })}
          >
            <MessageSquareShare className="size-4 shrink-0" />
            <span className="truncate">Give feedback</span>
          </button>

          {appVersion ? (
            <MicroLabel className="lowercase text-foreground-passive">v{appVersion}</MicroLabel>
          ) : null}
        </div>
      </SidebarContainer>
    </div>
  );
});
