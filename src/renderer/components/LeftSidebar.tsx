import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import ReorderList from './ReorderList';
import { Button } from './ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from './ui/sidebar';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import {
  Home,
  ChevronRight,
  Plus,
  FolderOpen,
  Github,
  Archive,
  RotateCcw,
  Globe,
  Server,
  Puzzle,
} from 'lucide-react';
import SidebarEmptyState from './SidebarEmptyState';
import { TaskItem } from './TaskItem';
import ProjectDeleteButton from './ProjectDeleteButton';
import { TaskDeleteButton } from './TaskDeleteButton';
import { RemoteProjectIndicator } from './ssh/RemoteProjectIndicator';
import { useRemoteProject } from '../hooks/useRemoteProject';
import type { Project } from '../types/app';
import type { Task } from '../types/chat';
import type { ConnectionState } from './ssh';

interface LeftSidebarProps {
  projects: Project[];
  archivedTasksVersion?: number;
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onGoHome: () => void;
  onOpenProject?: () => void;
  onNewProject?: () => void;
  onCloneProject?: () => void;
  onAddRemoteProject?: () => void;
  onSelectTask?: (task: Task) => void;
  activeTask?: Task | null;
  onReorderProjects?: (sourceId: string, targetId: string) => void;
  onReorderProjectsFull?: (newOrder: Project[]) => void;
  onSidebarContextChange?: (state: {
    open: boolean;
    isMobile: boolean;
    setOpen: (next: boolean) => void;
  }) => void;
  onCreateTaskForProject?: (project: Project) => void;
  onDeleteTask?: (project: Project, task: Task) => void | Promise<void | boolean>;
  onRenameTask?: (project: Project, task: Task, newName: string) => void | Promise<void>;
  onArchiveTask?: (project: Project, task: Task) => void | Promise<void | boolean>;
  onRestoreTask?: (project: Project, task: Task) => void | Promise<void>;
  onDeleteProject?: (project: Project) => void | Promise<void>;
  pinnedTaskIds?: Set<string>;
  onPinTask?: (task: Task) => void;
  isHomeView?: boolean;
  onGoToSkills?: () => void;
  isSkillsView?: boolean;
  onCloseSettingsPage?: () => void;
}

interface MenuItemButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}

// Helper to determine if a project is remote
const isRemoteProject = (project: Project): boolean => {
  return Boolean((project as any).isRemote || (project as any).sshConnectionId);
};

// Get connection ID from project
const getConnectionId = (project: Project): string | null => {
  return (project as any).sshConnectionId || null;
};

// Project item with remote indicator - MEMOIZED to prevent lag during parent toggles
interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  onSelect: () => void;
}

const ProjectItem = React.memo<ProjectItemProps>(({ project, isActive, onSelect }) => {
  const remote = useRemoteProject(project);
  const connectionId = getConnectionId(project);

  return (
    <div className="flex min-w-0 items-center gap-2">
      {isRemoteProject(project) && connectionId && (
        <RemoteProjectIndicator
          host={remote.host || undefined}
          connectionState={remote.connectionState as ConnectionState}
          size="md"
          onReconnect={remote.reconnect}
          disabled={remote.isLoading}
        />
      )}
      <span className="flex-1 truncate">{project.name}</span>
    </div>
  );
});
ProjectItem.displayName = 'ProjectItem';

const MenuItemButton = React.memo<MenuItemButtonProps>(
  ({ icon: Icon, label, ariaLabel, onClick }) => {
    const handleKeyDown = React.useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      },
      [onClick]
    );

    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={0}
        aria-label={ariaLabel}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-foreground hover:bg-muted dark:text-muted-foreground dark:hover:bg-accent"
        onClick={onClick}
        onKeyDown={handleKeyDown}
      >
        <Icon className="h-4 w-4" />
        {label}
      </button>
    );
  }
);
MenuItemButton.displayName = 'MenuItemButton';

const LeftSidebar: React.FC<LeftSidebarProps> = ({
  projects,
  archivedTasksVersion,
  selectedProject,
  onSelectProject,
  onGoHome,
  onOpenProject,
  onNewProject,
  onCloneProject,
  onAddRemoteProject,
  onSelectTask,
  activeTask,
  onReorderProjects,
  onReorderProjectsFull,
  onSidebarContextChange,
  onCreateTaskForProject,
  onDeleteTask,
  onRenameTask,
  onArchiveTask,
  onRestoreTask,
  onDeleteProject,
  pinnedTaskIds,
  onPinTask,
  isHomeView,
  onGoToSkills,
  isSkillsView,
  onCloseSettingsPage,
}) => {
  const { open, isMobile, setOpen } = useSidebar();
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [archivedTasksByProject, setArchivedTasksByProject] = useState<Record<string, Task[]>>({});

  const fetchArchivedTasks = useCallback(async () => {
    const archived: Record<string, Task[]> = {};
    for (const project of projects) {
      try {
        const tasks = await window.electronAPI.getArchivedTasks(project.id);
        if (tasks && tasks.length > 0) {
          archived[project.id] = tasks;
        }
      } catch (err) {
        console.error(`Failed to fetch archived tasks for project ${project.id}:`, err);
      }
    }
    setArchivedTasksByProject(archived);
  }, [projects]);

  useEffect(() => {
    if (projects.length > 0) {
      fetchArchivedTasks();
    }
  }, [projects.length, archivedTasksVersion, fetchArchivedTasks]);

  const handleRestoreTask = useCallback(
    async (project: Project, task: Task) => {
      if (onRestoreTask) {
        await onRestoreTask(project, task);
        fetchArchivedTasks();
      }
    },
    [onRestoreTask, fetchArchivedTasks]
  );

  const handleArchiveTaskWithRefresh = useCallback(
    async (project: Project, task: Task) => {
      if (onArchiveTask) {
        await onArchiveTask(project, task);
        fetchArchivedTasks();
      }
    },
    [onArchiveTask, fetchArchivedTasks]
  );

  const handleDeleteProject = useCallback(
    async (project: Project) => {
      if (!onDeleteProject) return;
      setDeletingProjectId(project.id);
      try {
        await onDeleteProject(project);
      } finally {
        setDeletingProjectId((current) => (current === project.id ? null : current));
      }
    },
    [onDeleteProject]
  );

  useEffect(() => {
    onSidebarContextChange?.({ open, isMobile, setOpen });
  }, [open, isMobile, setOpen, onSidebarContextChange]);

  const handleNavigationWithCloseSettings = useCallback(
    (callback: () => void) => {
      onCloseSettingsPage?.();
      callback();
    },
    [onCloseSettingsPage]
  );

  return (
    <div className="relative h-full">
      <Sidebar className="!w-full lg:border-r-0">
        <SidebarHeader className="border-b-0 px-3 py-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className={`min-w-0 ${isHomeView ? 'bg-black/5 dark:bg-white/5' : ''}`}
              >
                <Button
                  variant="ghost"
                  onClick={() => handleNavigationWithCloseSettings(onGoHome)}
                  aria-label="Home"
                  className="w-full justify-start"
                >
                  <Home className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
                  <span className="hidden text-sm font-medium sm:inline">Home</span>
                </Button>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {onGoToSkills && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  className={`min-w-0 ${isSkillsView ? 'bg-black/5 dark:bg-white/5' : ''}`}
                >
                  <Button
                    variant="ghost"
                    onClick={() => handleNavigationWithCloseSettings(onGoToSkills)}
                    aria-label="Skills"
                    className="w-full justify-start"
                  >
                    <Puzzle className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
                    <span className="hidden text-sm font-medium sm:inline">Skills</span>
                  </Button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {projects.length === 0 && (
            <SidebarEmptyState
              title="No projects yet"
              description="Open a project to start creating worktrees and running coding agents."
              actionLabel={onOpenProject ? 'Open Project' : undefined}
              onAction={onOpenProject}
              secondaryActionLabel={onNewProject ? 'New Project' : undefined}
              onSecondaryAction={onNewProject}
            />
          )}

          <SidebarGroup>
            <SidebarGroupLabel className="sr-only">Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <ReorderList
                  as="div"
                  axis="y"
                  items={projects}
                  onReorder={(newOrder) => {
                    if (onReorderProjectsFull) {
                      onReorderProjectsFull(newOrder as Project[]);
                    } else if (onReorderProjects) {
                      const oldIds = projects.map((p) => p.id);
                      const newIds = (newOrder as Project[]).map((p) => p.id);
                      for (let i = 0; i < newIds.length; i++) {
                        if (newIds[i] !== oldIds[i]) {
                          const sourceId = newIds.find((id) => id === oldIds[i]);
                          const targetId = newIds[i];
                          if (sourceId && targetId && sourceId !== targetId) {
                            onReorderProjects(sourceId, targetId);
                          }
                          break;
                        }
                      }
                    }
                  }}
                  className="m-0 min-w-0 list-none space-y-1 p-0"
                  itemClassName="relative group cursor-pointer rounded-md list-none min-w-0"
                  getKey={(p) => (p as Project).id}
                >
                  {(project) => {
                    const typedProject = project as Project;
                    const isDeletingProject = deletingProjectId === typedProject.id;
                    const showProjectDelete = Boolean(onDeleteProject);
                    const isProjectActive = selectedProject?.id === typedProject.id;
                    const projectIsRemote = isRemoteProject(typedProject);
                    return (
                      <SidebarMenuItem>
                        <Collapsible defaultOpen className="group/collapsible">
                          <div
                            className={`group/project group/task relative flex w-full min-w-0 items-center rounded-md px-2 py-2 text-sm font-medium focus-within:bg-accent focus-within:text-accent-foreground hover:bg-accent hover:text-accent-foreground ${
                              isProjectActive ? 'bg-black/5 dark:bg-white/5' : ''
                            }`}
                            title={projectIsRemote ? 'Remote Project' : undefined}
                          >
                            <motion.button
                              type="button"
                              whileTap={{ scale: 0.97 }}
                              transition={{ duration: 0.1, ease: 'easeInOut' }}
                              className="flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent pr-7 text-left outline-none focus-visible:outline-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleNavigationWithCloseSettings(() =>
                                  onSelectProject(typedProject)
                                );
                              }}
                            >
                              <span className="block w-full truncate">
                                <ProjectItem
                                  project={typedProject}
                                  isActive={isProjectActive}
                                  onSelect={() => onSelectProject(typedProject)}
                                />
                              </span>
                              <span className="hidden w-full truncate text-xs text-muted-foreground sm:block">
                                {typedProject.githubInfo?.repository || typedProject.path}
                              </span>
                            </motion.button>
                            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                              {showProjectDelete ? (
                                <ProjectDeleteButton
                                  projectName={typedProject.name}
                                  tasks={typedProject.tasks || []}
                                  onConfirm={() => handleDeleteProject(typedProject)}
                                  isDeleting={isDeletingProject}
                                  aria-label={`Delete project ${typedProject.name}`}
                                  className={`bg-accent text-muted-foreground ${
                                    isDeletingProject
                                      ? ''
                                      : 'opacity-0 group-hover/project:opacity-100'
                                  }`}
                                />
                              ) : null}
                              <CollapsibleTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Toggle tasks for ${typedProject.name}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-muted-foreground opacity-0 group-hover/project:opacity-100 group-data-[state=open]/collapsible:opacity-100"
                                >
                                  <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-90" />
                                </Button>
                              </CollapsibleTrigger>
                            </div>
                          </div>

                          {/* OPTIMIZATION: forceMount + CSS hidden ensures instant toggle by avoiding re-mounting costs */}
                          <CollapsibleContent
                            forceMount
                            className="mt-1 min-w-0 data-[state=closed]:hidden"
                          >
                            <div className="min-w-0">
                              <motion.button
                                type="button"
                                whileTap={{ scale: 0.97 }}
                                transition={{ duration: 0.1, ease: 'easeInOut' }}
                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleNavigationWithCloseSettings(() => {
                                    if (
                                      onSelectProject &&
                                      selectedProject?.id !== typedProject.id
                                    ) {
                                      onSelectProject(typedProject);
                                    } else if (!selectedProject) {
                                      onSelectProject?.(typedProject);
                                    }
                                    onCreateTaskForProject?.(typedProject);
                                  });
                                }}
                                aria-label={`New Task for ${typedProject.name}`}
                              >
                                <Plus
                                  className="h-3 w-3 flex-shrink-0 text-muted-foreground"
                                  aria-hidden
                                />
                                <span className="truncate">New Task</span>
                              </motion.button>
                              <div className="hidden min-w-0 space-y-0.5 sm:block">
                                {typedProject.tasks
                                  ?.slice()
                                  .sort((a, b) => {
                                    const aPinned = pinnedTaskIds?.has(a.id) ? 1 : 0;
                                    const bPinned = pinnedTaskIds?.has(b.id) ? 1 : 0;
                                    return bPinned - aPinned;
                                  })
                                  .map((task) => {
                                    const isActive = activeTask?.id === task.id;
                                    return (
                                      <div
                                        key={task.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleNavigationWithCloseSettings(() => {
                                            if (
                                              onSelectProject &&
                                              selectedProject?.id !== typedProject.id
                                            ) {
                                              onSelectProject(typedProject);
                                            }
                                            onSelectTask && onSelectTask(task);
                                          });
                                        }}
                                        className={`group/task min-w-0 rounded-md px-2 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 ${
                                          isActive ? 'bg-black/5 dark:bg-white/5' : ''
                                        }`}
                                        title={task.name}
                                      >
                                        <TaskItem
                                          task={task}
                                          showDelete
                                          showDirectBadge={false}
                                          isPinned={pinnedTaskIds?.has(task.id)}
                                          onPin={onPinTask ? () => onPinTask(task) : undefined}
                                          onDelete={
                                            onDeleteTask
                                              ? () => onDeleteTask(typedProject, task)
                                              : undefined
                                          }
                                          onRename={
                                            onRenameTask && !task.metadata?.multiAgent?.enabled
                                              ? (newName) =>
                                                  onRenameTask(typedProject, task, newName)
                                              : undefined
                                          }
                                          onArchive={
                                            onArchiveTask
                                              ? () =>
                                                  handleArchiveTaskWithRefresh(typedProject, task)
                                              : undefined
                                          }
                                        />
                                      </div>
                                    );
                                  })}

                                {archivedTasksByProject[typedProject.id]?.length > 0 && (
                                  <Collapsible className="mt-1">
                                    <CollapsibleTrigger asChild>
                                      <button
                                        type="button"
                                        className="group/archived flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                                      >
                                        <Archive className="h-3 w-3 opacity-50" />
                                        <span>
                                          Archived ({archivedTasksByProject[typedProject.id].length}
                                          )
                                        </span>
                                        <div className="ml-auto flex h-3 w-3 flex-shrink-0 items-center justify-center">
                                          <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]/archived:rotate-90" />
                                        </div>
                                      </button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <div className="ml-1.5 space-y-0.5 border-l border-border/50 pl-2">
                                        {archivedTasksByProject[typedProject.id].map(
                                          (archivedTask) => (
                                            <div
                                              key={archivedTask.id}
                                              className="group/archived-task flex min-w-0 items-center justify-between gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5"
                                            >
                                              <span className="truncate text-xs font-medium">
                                                {archivedTask.name}
                                              </span>
                                              <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/archived-task:opacity-100">
                                                <TooltipProvider>
                                                  <Tooltip>
                                                    <TooltipTrigger asChild>
                                                      <Button
                                                        variant="ghost"
                                                        size="icon-sm"
                                                        className="h-5 w-5"
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          handleRestoreTask(
                                                            typedProject,
                                                            archivedTask
                                                          );
                                                        }}
                                                      >
                                                        <RotateCcw className="h-3 w-3" />
                                                      </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent side="top" className="text-xs">
                                                      Restore Task
                                                    </TooltipContent>
                                                  </Tooltip>
                                                </TooltipProvider>
                                                <TaskDeleteButton
                                                  taskName={archivedTask.name}
                                                  taskId={archivedTask.id}
                                                  taskPath={archivedTask.path}
                                                  useWorktree={archivedTask.useWorktree !== false}
                                                  className="h-5 w-5"
                                                  onConfirm={async () => {
                                                    if (onDeleteTask) {
                                                      await onDeleteTask(
                                                        typedProject,
                                                        archivedTask
                                                      );
                                                      fetchArchivedTasks();
                                                    }
                                                  }}
                                                />
                                              </div>
                                            </div>
                                          )
                                        )}
                                      </div>
                                    </CollapsibleContent>
                                  </Collapsible>
                                )}
                              </div>
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      </SidebarMenuItem>
                    );
                  }}
                </ReorderList>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {projects.length > 0 && onOpenProject && (
            <SidebarGroup className="mt-2">
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="mt-1 w-full justify-start">
                          <Plus className="mr-2 h-4 w-4" />
                          <span className="text-sm font-medium">Add Project</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-1" align="start" sideOffset={4}>
                        <div className="space-y-1">
                          <MenuItemButton
                            icon={FolderOpen}
                            label="Open Folder"
                            ariaLabel="Open Folder"
                            onClick={() => onOpenProject?.()}
                          />
                          <MenuItemButton
                            icon={Plus}
                            label="Create New"
                            ariaLabel="Create New Project"
                            onClick={() => onNewProject?.()}
                          />
                          <MenuItemButton
                            icon={Github}
                            label="Clone from GitHub"
                            ariaLabel="Clone from GitHub"
                            onClick={() => onCloneProject?.()}
                          />
                          {onAddRemoteProject && (
                            <MenuItemButton
                              icon={Server}
                              label="Add Remote Project"
                              ariaLabel="Add Remote Project"
                              onClick={() => onAddRemoteProject?.()}
                            />
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
      </Sidebar>
    </div>
  );
};

export default LeftSidebar;
