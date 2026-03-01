import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import {
  Home,
  Plus,
  FolderOpen,
  FolderClosed,
  FolderPlus,
  Github,
  Server,
  Puzzle,
  Archive,
  RotateCcw,
  ChevronRight,
} from 'lucide-react';
import SidebarEmptyState from './SidebarEmptyState';
import { TaskItem } from './TaskItem';
import { TaskDeleteButton } from './TaskDeleteButton';
import { RemoteProjectIndicator } from './ssh/RemoteProjectIndicator';
import { useRemoteProject } from '../hooks/useRemoteProject';
import type { Project } from '../types/app';
import type { Task } from '../types/chat';
import type { ConnectionState } from './ssh';
import { rpc } from '../lib/rpc';

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

const isRemoteProject = (project: Project): boolean => {
  return Boolean((project as any).isRemote || (project as any).sshConnectionId);
};

const getConnectionId = (project: Project): string | null => {
  return (project as any).sshConnectionId || null;
};

interface ProjectItemProps {
  project: Project;
  isActive: boolean;
  onSelect: () => void;
}

const ProjectItem = React.memo<ProjectItemProps>(({ project, isActive, onSelect }) => {
  const remote = useRemoteProject(project);
  const connectionId = getConnectionId(project);

  if (!connectionId && !isRemoteProject(project)) {
    return <span className="flex-1 truncate">{project.name}</span>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {connectionId && (
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

  const [taskHoverAction, setTaskHoverAction] = useState<'delete' | 'archive'>('delete');
  useEffect(() => {
    window.electronAPI.getSettings().then((r) => {
      if (r.success) setTaskHoverAction(r.settings?.interface?.taskHoverAction ?? 'delete');
    });
    const handler = (e: Event) => setTaskHoverAction((e as CustomEvent).detail.value);
    window.addEventListener('taskHoverActionChanged', handler);
    return () => window.removeEventListener('taskHoverActionChanged', handler);
  }, []);

  const [forceOpenIds, setForceOpenIds] = useState<Set<string>>(new Set());
  const prevTaskCountsRef = useRef<Map<string, number>>(new Map());
  const [archivedTasksByProject, setArchivedTasksByProject] = useState<Record<string, Task[]>>({});

  const fetchArchivedTasks = useCallback(async () => {
    const archived: Record<string, Task[]> = {};
    for (const project of projects) {
      try {
        const tasks = (await rpc.db.getArchivedTasks(project.id)) as Task[];
        if (tasks && tasks.length > 0) archived[project.id] = tasks;
      } catch (err) {}
    }
    setArchivedTasksByProject(archived);
  }, [projects]);

  useEffect(() => {
    const prev = prevTaskCountsRef.current;
    for (const project of projects) {
      const taskCount = project.tasks?.length ?? 0;
      const prevCount = prev.get(project.id) ?? 0;
      if (prevCount === 0 && taskCount > 0) {
        setForceOpenIds((s) => new Set(s).add(project.id));
      }
      prev.set(project.id, taskCount);
    }
  }, [projects]);

  useEffect(() => {
    if (projects.length > 0) fetchArchivedTasks();
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
                className={`min-w-0 ${isHomeView ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
              >
                <Button
                  variant="ghost"
                  onClick={() => handleNavigationWithCloseSettings(onGoHome)}
                  aria-label="Home"
                  className="w-full justify-start"
                >
                  <Home className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
                  <span className="text-sm font-medium">Home</span>
                </Button>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {onGoToSkills && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  className={`min-w-0 ${isSkillsView ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
                >
                  <Button
                    variant="ghost"
                    onClick={() => handleNavigationWithCloseSettings(onGoToSkills)}
                    aria-label="Skills"
                    className="w-full justify-start"
                  >
                    <Puzzle className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
                    <span className="text-sm font-medium">Skills</span>
                  </Button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent className="flex flex-col">
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center justify-between pr-0">
              <span className="cursor-default select-none text-sm font-medium normal-case tracking-normal text-foreground/30">
                Projects
              </span>
              {onOpenProject && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon-sm" className="text-foreground/30">
                      <FolderPlus className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-1" align="start" sideOffset={4}>
                    <div className="space-y-1">
                      <MenuItemButton
                        icon={FolderOpen}
                        label="Open Folder"
                        ariaLabel="Open"
                        onClick={() => onOpenProject?.()}
                      />
                      <MenuItemButton
                        icon={Plus}
                        label="Create New"
                        ariaLabel="New"
                        onClick={() => onNewProject?.()}
                      />
                      <MenuItemButton
                        icon={Github}
                        label="Clone"
                        ariaLabel="Clone"
                        onClick={() => onCloneProject?.()}
                      />
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </SidebarGroupLabel>
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
                          onReorderProjects(newIds.find((id) => id === oldIds[i])!, newIds[i]);
                          break;
                        }
                      }
                    }
                  }}
                  className="m-0 flex min-w-0 list-none flex-col gap-1 p-0"
                  itemClassName="relative group cursor-pointer rounded-md list-none min-w-0"
                  getKey={(p) => (p as Project).id}
                >
                  {(project) => {
                    const typedProject = project as Project;
                    const isProjectActive = selectedProject?.id === typedProject.id && !activeTask;
                    return (
                      <SidebarMenuItem>
                        <Collapsible
                          defaultOpen
                          open={forceOpenIds.has(typedProject.id) ? true : undefined}
                          onOpenChange={() => {
                            if (forceOpenIds.has(typedProject.id)) {
                              setForceOpenIds((s) => {
                                const n = new Set(s);
                                n.delete(typedProject.id);
                                return n;
                              });
                            }
                          }}
                          className="group/collapsible"
                        >
                          <div
                            className={`group/project relative flex w-full min-w-0 items-center gap-1.5 rounded-md py-1.5 pl-1 pr-1 text-sm font-medium hover:bg-accent ${isProjectActive ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
                          >
                            <CollapsibleTrigger asChild>
                              <button
                                type="button"
                                className="flex-shrink-0 rounded p-0.5 outline-none hover:bg-black/5 dark:hover:bg-white/5"
                              >
                                <FolderOpen className="hidden h-4 w-4 text-foreground/60 group-data-[state=open]/collapsible:block" />
                                <FolderClosed className="block h-4 w-4 text-foreground/60 group-data-[state=open]/collapsible:hidden" />
                              </button>
                            </CollapsibleTrigger>
                            <motion.button
                              type="button"
                              className="min-w-0 flex-1 truncate bg-transparent text-left text-foreground/60"
                              whileTap={{ scale: 0.97 }}
                              onClick={() =>
                                handleNavigationWithCloseSettings(() =>
                                  onSelectProject(typedProject)
                                )
                              }
                            >
                              <ProjectItem
                                project={typedProject}
                                isActive={isProjectActive}
                                onSelect={() => onSelectProject(typedProject)}
                              />
                            </motion.button>
                            {onCreateTaskForProject && (
                              <button
                                type="button"
                                className="p-0.5 text-muted-foreground hover:bg-black/5"
                                onClick={() =>
                                  handleNavigationWithCloseSettings(() =>
                                    onCreateTaskForProject(typedProject)
                                  )
                                }
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            )}
                          </div>

                          <CollapsibleContent
                            forceMount
                            className="mt-1 min-w-0 data-[state=closed]:hidden"
                          >
                            <div className="flex min-w-0 flex-col gap-1">
                              {typedProject.tasks
                                ?.slice()
                                .sort(
                                  (a, b) =>
                                    (pinnedTaskIds?.has(b.id) ? 1 : 0) -
                                    (pinnedTaskIds?.has(a.id) ? 1 : 0)
                                )
                                .map((task) => {
                                  const isActive = activeTask?.id === task.id;
                                  return (
                                    <motion.div
                                      key={task.id}
                                      whileTap={{ scale: 0.97 }}
                                      onClick={() =>
                                        handleNavigationWithCloseSettings(() =>
                                          onSelectTask?.(task)
                                        )
                                      }
                                      className={`group/task min-w-0 rounded-md py-1.5 pl-1 pr-2 hover:bg-accent ${isActive ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
                                    >
                                      <TaskItem
                                        task={task}
                                        showDelete={true}
                                        showDirectBadge={false}
                                        isPinned={pinnedTaskIds?.has(task.id)}
                                        onPin={() => onPinTask?.(task)}
                                        onRename={(n) => onRenameTask?.(typedProject, task, n)}
                                        onDelete={() => onDeleteTask?.(typedProject, task)}
                                        onArchive={() => onArchiveTask?.(typedProject, task)}
                                        primaryAction={taskHoverAction}
                                      />
                                    </motion.div>
                                  );
                                })}
                              {archivedTasksByProject[typedProject.id]?.length > 0 && (
                                <Collapsible className="mt-1">
                                  <CollapsibleTrigger asChild>
                                    <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-black/5">
                                      <Archive className="h-3 w-3 opacity-50" />
                                      <span>
                                        Archived ({archivedTasksByProject[typedProject.id].length})
                                      </span>
                                      <ChevronRight className="ml-auto h-3 w-3 transition-transform group-data-[state=open]/archived:rotate-90" />
                                    </button>
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    <div className="ml-1.5 space-y-0.5 border-l pl-2">
                                      {archivedTasksByProject[typedProject.id].map(
                                        (archivedTask) => (
                                          <div
                                            key={archivedTask.id}
                                            className="flex min-w-0 items-center justify-between gap-2 px-2 py-1.5 text-muted-foreground"
                                          >
                                            <span className="truncate text-xs font-medium">
                                              {archivedTask.name}
                                            </span>
                                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                                              <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() =>
                                                  handleRestoreTask(typedProject, archivedTask)
                                                }
                                              >
                                                <RotateCcw className="h-3 w-3" />
                                              </Button>
                                              <TaskDeleteButton
                                                taskName={archivedTask.name}
                                                taskId={archivedTask.id}
                                                taskPath={archivedTask.path}
                                                useWorktree={archivedTask.useWorktree !== false}
                                                onConfirm={async () => {
                                                  await onDeleteTask?.(typedProject, archivedTask);
                                                  fetchArchivedTasks();
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
                          </CollapsibleContent>
                        </Collapsible>
                      </SidebarMenuItem>
                    );
                  }}
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
  );
};

export default LeftSidebar;
