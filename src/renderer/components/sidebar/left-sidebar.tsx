import { Home, Plug, Puzzle, Settings } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React from 'react';
import ReorderList from '@renderer/components/reorder-list';
import SidebarEmptyState from '@renderer/components/sidebar/sidebar-empty-state';
import { projectManagerStore } from '@renderer/core/stores/project-manager';
import { sidebarStore } from '@renderer/core/stores/sidebar-store';
import {
  isCurrentView,
  useNavigate,
  useWorkspaceSlots,
} from '@renderer/core/view/navigation-provider';
import { SidebarProjectItem } from './project-item';
import { ProjectsGroupLabel } from './projects-group-label';
import {
  SidebarContainer,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
} from './sidebar-primitives';
import { SidebarSpace } from './sidebar-space';

export const LeftSidebar: React.FC = observer(function LeftSidebar() {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();

  const orderedProjects = sidebarStore.orderedProjects;
  const isEmpty = projectManagerStore.projects.size === 0;

  return (
    <div className="relative h-full">
      <SidebarSpace />
      <SidebarContainer className="w-full lg:border-r-0">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'home')}
              onClick={() => navigate('home')}
              aria-label="Home"
              className="w-full justify-start"
            >
              <Home className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
              Home
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'skills')}
              onClick={() => navigate('skills')}
              aria-label="Home"
              className="w-full justify-start"
            >
              <Puzzle className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
              Skills
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'mcp')}
              onClick={() => navigate('mcp')}
              aria-label="MCP"
              className="w-full justify-start"
            >
              <Plug className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
              MCP
            </SidebarMenuButton>
            <SidebarMenuButton
              isActive={isCurrentView(currentView, 'settings')}
              onClick={() => navigate('settings')}
              aria-label="Home"
              className="w-full justify-start"
            >
              <Settings className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
              Settings
            </SidebarMenuButton>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent className="flex flex-col">
          <SidebarGroup>
            <ProjectsGroupLabel />
            <SidebarGroupContent>
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
          {isEmpty && (
            <div className="mt-auto">
              <SidebarEmptyState
                title="Put your agents to work"
                description="Create a task and run one or more agents on it in parallel."
                actionLabel="Open Folder"
                onAction={() => {}}
              />
            </div>
          )}
        </SidebarContent>
      </SidebarContainer>
    </div>
  );
});
