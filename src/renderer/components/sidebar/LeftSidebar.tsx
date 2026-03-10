import { Home, Puzzle, Settings } from 'lucide-react';
import React, { useCallback, useEffect, useMemo } from 'react';
import ReorderList from '@renderer/components/ReorderList';
import SidebarEmptyState from '@renderer/components/SidebarEmptyState';
import { Button } from '@renderer/components/ui/button';
import { useProjectManagementContext } from '@renderer/contexts/ProjectManagementProvider';
import {
  isCurrentView,
  useWorkspaceNavigation,
  useWorkspaceSlots,
} from '@renderer/contexts/WorkspaceNavigationContext';
import { useLocalStorage } from '@renderer/hooks/useLocalStorage';
import type { Project } from '@renderer/types/app';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '../ui/sidebar';
import { SidebarProjectItem } from './ProjectItem';
import { ProjectsGroupLabel } from './ProjectsGroupLabel';
import { SidebarProvider } from './SidebarProvider';
import { SidebarSpace } from './SidebarSpace';

const PROJECT_ORDER_KEY = 'sidebarProjectOrder';

interface LeftSidebarProps {
  onSidebarContextChange?: (state: {
    open: boolean;
    isMobile: boolean;
    setOpen: (next: boolean) => void;
  }) => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ onSidebarContextChange }) => {
  const { open, isMobile, setOpen } = useSidebar();
  const { projects, handleOpenProject: onOpenProject } = useProjectManagementContext();
  const { navigate } = useWorkspaceNavigation();
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

  const handleReorderProjects = useCallback(
    (newOrder: Project[]) => {
      setProjectOrder(newOrder.map((p) => p.id));
    },
    [setProjectOrder]
  );

  useEffect(() => {
    onSidebarContextChange?.({ open, isMobile, setOpen });
  }, [open, isMobile, setOpen, onSidebarContextChange]);

  return (
    <SidebarProvider>
      <div className="relative h-full">
        <SidebarSpace />
        <Sidebar className="!w-full lg:border-r-0">
          <SidebarHeader className="border-b-0 px-3 py-3">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className={`min-w-0 ${isCurrentView(currentView, 'home') ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
                >
                  <Button
                    variant="ghost"
                    onClick={() => navigate('home')}
                    aria-label="Home"
                    className="w-full justify-start"
                  >
                    <Home className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
                    <span className="text-sm font-medium">Home</span>
                  </Button>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className={`min-w-0 ${isCurrentView(currentView, 'skills') ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
                >
                  <Button
                    variant="ghost"
                    onClick={() => navigate('skills')}
                    aria-label="Skills"
                    className="w-full justify-start"
                  >
                    <Puzzle className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
                    <span className="text-sm font-medium">Skills</span>
                  </Button>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className={`min-w-0 ${isCurrentView(currentView, 'settings') ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
                >
                  <Button
                    variant="ghost"
                    onClick={() => navigate('settings')}
                    aria-label="Settings"
                    className="w-full justify-start"
                  >
                    <Settings className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
                    <span className="text-sm font-medium">Settings</span>
                  </Button>
                </SidebarMenuButton>
              </SidebarMenuItem>
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
                    items={sortedProjects}
                    onReorder={(newOrder) => handleReorderProjects(newOrder as Project[])}
                    className="m-0 flex min-w-0 list-none flex-col gap-1 p-0"
                    itemClassName="relative group cursor-pointer rounded-md list-none min-w-0"
                    getKey={(p) => (p as Project).id}
                  >
                    {(project) => <SidebarProjectItem project={project as Project} />}
                  </ReorderList>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            {projects.length === 0 && (
              <div className="mt-auto">
                <SidebarEmptyState
                  title="Put your agents to work"
                  description="Create a task and run one or more agents on it in parallel."
                  actionLabel="Open Folder"
                  onAction={onOpenProject}
                />
              </div>
            )}
          </SidebarContent>
        </Sidebar>
      </div>
    </SidebarProvider>
  );
};
