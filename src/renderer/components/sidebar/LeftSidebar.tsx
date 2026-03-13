import { AlertCircle, Home, Loader2, Puzzle, Settings } from 'lucide-react';
import React, { useCallback, useMemo } from 'react';
import type { LocalProject, SshProject } from '@shared/projects';
import {
  usePendingProjectsContext,
  type PendingProject,
} from '@renderer/components/add-project-modal/pending-projects-provider';
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
import { SidebarProjectItem } from './ProjectItem';
import { ProjectsGroupLabel } from './ProjectsGroupLabel';
import {
  SidebarContainer,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from './sidebar-primitives';
import { SidebarProvider } from './SidebarProvider';
import { SidebarSpace } from './SidebarSpace';

const PROJECT_ORDER_KEY = 'sidebarProjectOrder';

type SidebarListItem =
  | { status: 'ready'; data: LocalProject | SshProject }
  | { status: 'creating'; data: PendingProject };

const STAGE_LABEL: Record<PendingProject['stage'], string> = {
  'creating-repo': 'Creating repository…',
  cloning: 'Cloning…',
  initializing: 'Initializing…',
  registering: 'Registering…',
  error: 'Failed',
};

const PendingSidebarItem = React.memo<{ project: PendingProject }>(({ project }) => {
  const { navigate } = useWorkspaceNavigation();
  const isError = project.stage === 'error';

  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
      onClick={() => navigate('project', { projectId: project.id })}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {isError ? (
          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground/80">{project.name}</span>
        <span className="block truncate text-xs text-muted-foreground/60">
          {STAGE_LABEL[project.stage]}
        </span>
      </span>
    </button>
  );
});
PendingSidebarItem.displayName = 'PendingSidebarItem';

export const LeftSidebar: React.FC = () => {
  const { projects } = useProjectManagementContext();
  const { pendingProjects } = usePendingProjectsContext();
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

  // Merge pending (prepended) + real projects into a single unified list for ReorderList
  const allItems = useMemo<SidebarListItem[]>(() => {
    const pendingItems: SidebarListItem[] = pendingProjects.map((p) => ({
      status: 'creating',
      data: p,
    }));
    const realItems: SidebarListItem[] = sortedProjects.map((p) => ({
      status: 'ready',
      data: p,
    }));
    return [...pendingItems, ...realItems];
  }, [pendingProjects, sortedProjects]);

  const handleReorder = useCallback(
    (newOrder: SidebarListItem[]) => {
      // Only persist order for real (ready) projects
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
        <SidebarContainer className="!w-full lg:border-r-0">
          <SidebarHeader>
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
                    items={allItems}
                    onReorder={(newOrder) => handleReorder(newOrder as SidebarListItem[])}
                    className="m-0 flex min-w-0 list-none flex-col gap-1 p-0"
                    itemClassName="relative group cursor-pointer rounded-md list-none min-w-0"
                    getKey={(item) => (item as SidebarListItem).data.id}
                  >
                    {(item) => {
                      const sidebarItem = item as SidebarListItem;
                      if (sidebarItem.status === 'creating') {
                        return <PendingSidebarItem project={sidebarItem.data} />;
                      }
                      return (
                        <SidebarProjectItem project={sidebarItem.data as unknown as Project} />
                      );
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
