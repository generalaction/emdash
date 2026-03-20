import { Home, Plug, Puzzle, Settings } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';
import type { LocalProject, SshProject } from '@shared/projects';
import {
  usePendingProjectsContext,
  type PendingProject,
} from '@renderer/components/add-project-modal/pending-projects-provider';
import ReorderList from '@renderer/components/reorder-list';
import SidebarEmptyState from '@renderer/components/sidebar/sidebar-empty-state';
import { useProjectsDataContext } from '@renderer/core/projects/projects-data-provider';
import {
  isCurrentView,
  useNavigate,
  useWorkspaceSlots,
} from '@renderer/core/view/navigation-provider';
import { useLocalStorage } from '@renderer/hooks/useLocalStorage';
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
import { SidebarProvider } from './sidebar-provider';
import { SidebarSpace } from './sidebar-space';

const PROJECT_ORDER_KEY = 'sidebarProjectOrder';

export type ProjectItem =
  | { status: 'ready'; data: LocalProject | SshProject }
  | { status: 'creating'; data: PendingProject };

export const LeftSidebar: React.FC = () => {
  const { projects } = useProjectsDataContext();
  const { pendingProjects } = usePendingProjectsContext();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();

  const [projectOrder, setProjectOrder] = useLocalStorage<string[]>(PROJECT_ORDER_KEY, []);

  const sortedProjects = useMemo(() => {
    if (!projectOrder.length) return projects;
    return [...projects].sort((a, b) => {
      const ai = projectOrder.indexOf(a.id);
      const bi = projectOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return -1;
      if (bi === -1) return 1;
      return ai - bi;
    });
  }, [projects, projectOrder]);

  const allItems = useMemo<ProjectItem[]>(() => {
    const pendingItems: ProjectItem[] = pendingProjects.map((p) => ({
      status: 'creating',
      data: p,
    }));
    const realItems: ProjectItem[] = sortedProjects.map((p) => ({
      status: 'ready',
      data: p,
    }));
    return [...pendingItems, ...realItems];
  }, [pendingProjects, sortedProjects]);

  const handleReorder = useCallback(
    (newOrder: ProjectItem[]) => {
      const realIds = newOrder
        .filter(
          (item): item is { status: 'ready'; data: LocalProject | SshProject } =>
            item.status === 'ready'
        )
        .map((item) => item.data.id);
      setProjectOrder(realIds);
    },
    [setProjectOrder]
  );

  return (
    <SidebarProvider>
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
                    items={allItems}
                    onReorder={(newOrder) => handleReorder(newOrder as ProjectItem[])}
                    className="m-0 flex min-w-0 list-none flex-col gap-1 p-0"
                    itemClassName="relative group cursor-pointer rounded-md list-none min-w-0"
                    getKey={(item) => (item as ProjectItem).data.id}
                  >
                    {(item) => {
                      return <SidebarProjectItem project={item} />;
                    }}
                  </ReorderList>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            {projects.length === 0 && pendingProjects.length === 0 && (
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
    </SidebarProvider>
  );
};
