import { FolderPlus, MessageSquareShare, Plug, Puzzle, Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import ReorderList from '@renderer/components/reorder-list';
import { useAppContext } from '@renderer/core/app/AppContextProvider';
import { useGithubContext } from '@renderer/core/github-context-provider';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { sidebarStore } from '@renderer/core/stores/sidebar-store';
import {
  isCurrentView,
  useNavigate,
  useWorkspaceSlots,
} from '@renderer/core/view/navigation-provider';
import { MicroLabel } from '../ui/label';
import ShortcutHint from '../ui/shortcut-hint';
import { SidebarProjectItem } from './project-item';
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

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { appVersion } = useAppContext();
  const { user: githubUser } = useGithubContext();

  const orderedProjects = sidebarStore.orderedProjects;

  const showAddProjectModal = useShowModal('addProjectModal');
  const showFeedbackModal = useShowModal('feedbackModal');

  return (
    <div className="flex flex-col h-full bg-background-tertiary text-foreground-tertiary-muted">
      <SidebarSpace />
      <SidebarContainer className="w-full border-r-0 flex-1 min-h-0">
        <SidebarContent className="flex flex-col">
          <SidebarGroup className="mb-0 min-h-0 flex-1 flex flex-col">
            <ProjectsGroupLabel />
            <SidebarGroupContent className="overflow-y-auto min-h-0 flex-1">
              <SidebarMenu>
                <ReorderList
                  as="div"
                  axis="y"
                  items={orderedProjects}
                  onReorder={(newOrder) => {
                    const ids = newOrder
                      .filter((p) => (p as (typeof orderedProjects)[0]).state !== 'unregistered')
                      .map((p) => {
                        const store = p as (typeof orderedProjects)[0];
                        return store.state !== 'unregistered' ? store.data.id : '';
                      })
                      .filter(Boolean);
                    sidebarStore.setProjectOrder(ids);
                  }}
                  className="m-0 flex min-w-0 list-none flex-col gap-1 p-0"
                  itemClassName="relative group cursor-pointer rounded-md list-none min-w-0"
                  getKey={(item) => {
                    const store = item as (typeof orderedProjects)[0];
                    return store.state === 'unregistered' ? store.id : store.data.id;
                  }}
                >
                  {(item) => <SidebarProjectItem project={item as (typeof orderedProjects)[0]} />}
                </ReorderList>
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
