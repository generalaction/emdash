import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import ReorderList from '../ReorderList';
import { Button } from '../ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from '../ui/sidebar';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import {
  Home,
  Plus,
  FolderOpen,
  FolderClosed,
  Puzzle,
  Plug,
  Timer,
  Archive,
  RotateCcw,
  ChevronRight,
  ArrowUpDown,
  Check,
  Trash2,
} from 'lucide-react';
import SidebarEmptyState from '../SidebarEmptyState';
import { TaskItem } from '../TaskItem';
import { RemoteProjectIndicator } from '../ssh/RemoteProjectIndicator';
import { useRemoteProject } from '../../hooks/useRemoteProject';
import type { Project, Task } from '../../types/app';
import type { ConnectionState } from '../ssh';
import { useProjectManagementContext } from '../../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../../contexts/TaskManagementContext';
import { useAppSettings } from '../../contexts/AppSettingsProvider';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { ProjectsGroupLabel } from './ProjectsGroupLabel';
import { useChangelogNotification } from '@/hooks/useChangelogNotification';
import { useModalContext } from '@/contexts/ModalProvider';
import { ChangelogNotificationCard } from './ChangelogNotificationCard';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

const PROJECT_ORDER_KEY = 'sidebarProjectOrder';
const TASK_ORDER_KEY = 'sidebarTaskOrder';
const TASK_SORT_MODE_KEY = 'sidebarTaskSortMode';
const COLLAPSED_PROJECTS_KEY = 'sidebarCollapsedProjects';

type TaskSortMode = 'createdAt' | 'lastActive' | 'alpha';

const SORT_MODE_LABELS: Record<TaskSortMode, string> = {
  createdAt: 'Creation Date',
  lastActive: 'Last Active',
  alpha: 'Alphabetical',
};

interface LeftSidebarProps {
  onSidebarContextChange?: (state: {
    open: boolean;
    isMobile: boolean;
    setOpen: (next: boolean) => void;
  }) => void;
  onCloseSettingsPage?: () => void;
  onOpenAccountSettings?: () => void;
}

const isRemoteProject = (project: Project): boolean => {
  return Boolean(project.isRemote || project.sshConnectionId);
};

const getConnectionId = (project: Project): string | null => {
  return project.sshConnectionId || null;
};

interface ProjectItemProps {
  project: Project;
}

const ProjectItem = React.memo<ProjectItemProps>(({ project }) => {
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

// ---------------------------------------------------------------------------
// Sort mode picker — shown on project row hover
// ---------------------------------------------------------------------------
interface SortModePickerProps {
  currentMode: TaskSortMode;
  onSelect: (mode: TaskSortMode) => void;
}

const SortModePicker = React.memo<SortModePickerProps>(({ currentMode, onSelect }) => {
  const modes: TaskSortMode[] = ['createdAt', 'lastActive', 'alpha'];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Sort tasks"
          className="p-0.5 text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5"
          onClick={(e) => e.stopPropagation()}
        >
          <ArrowUpDown className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="start" sideOffset={4}>
        <p className="px-2 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
          Sort by
        </p>
        <div className="space-y-0.5">
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted dark:text-muted-foreground dark:hover:bg-accent"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(mode);
              }}
            >
              <Check
                className={`h-3 w-3 flex-shrink-0 transition-opacity ${currentMode === mode ? 'opacity-100' : 'opacity-0'}`}
              />
              {SORT_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});
SortModePicker.displayName = 'SortModePicker';

// ---------------------------------------------------------------------------
// Sorting helpers
// ---------------------------------------------------------------------------
/** Apply a named sort criterion to unpinned tasks. Pinned tasks always float to top. */
function applySortCriterion(tasks: Task[], mode: TaskSortMode): Task[] {
  const pinned = tasks.filter((t) => t.metadata?.isPinned);
  const unpinned = tasks.filter((t) => !t.metadata?.isPinned);

  let sortedUnpinned: Task[];
  switch (mode) {
    case 'lastActive':
      sortedUnpinned = [...unpinned].sort((a, b) => {
        const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bt - at;
      });
      break;
    case 'alpha':
      sortedUnpinned = [...unpinned].sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'createdAt':
    default:
      sortedUnpinned = [...unpinned].sort((a, b) => {
        const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bt - at;
      });
      break;
  }

  return [...pinned, ...sortedUnpinned];
}

/** Restore a saved manual order, floating any new tasks to the top. */
function applyManualOrder(tasks: Task[], manualOrder: string[]): Task[] {
  const pinned = tasks.filter((t) => t.metadata?.isPinned);
  const unpinned = tasks.filter((t) => !t.metadata?.isPinned);
  const indexMap = new Map(manualOrder.map((id, i) => [id, i]));
  const sortedUnpinned = [...unpinned].sort((a, b) => {
    const ai = indexMap.get(a.id) ?? -1;
    const bi = indexMap.get(b.id) ?? -1;
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return -1; // new task floats to top
    if (bi === -1) return 1;
    return ai - bi;
  });
  return [...pinned, ...sortedUnpinned];
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  onSidebarContextChange,
  onCloseSettingsPage,
  onOpenAccountSettings,
}) => {
  const { open, isMobile, setOpen } = useSidebar();
  const automationsEnabled = useFeatureFlag('automations');
  const { showModal } = useModalContext();
  const {
    projects,
    selectedProject,
    showHomeView: isHomeView,
    showSkillsView: isSkillsView,
    showMcpView: isMcpView,
    showAutomationsView: isAutomationsView,
    handleSelectProject: onSelectProject,
    handleGoHome: onGoHome,
    handleOpenProject: onOpenProject,
    handleGoToSkills: onGoToSkills,
    handleGoToMcp: onGoToMcp,
    handleGoToAutomations: onGoToAutomations,
  } = useProjectManagementContext();

  const [projectOrder, setProjectOrder] = useLocalStorage<string[]>(PROJECT_ORDER_KEY, []);

  // --- Collapsed project folders state (persisted as array, used as Set) ---
  const [collapsedProjectsArray, setCollapsedProjectsArray] = useLocalStorage<string[]>(
    COLLAPSED_PROJECTS_KEY,
    []
  );
  const collapsedProjects = useMemo(
    () => new Set(collapsedProjectsArray),
    [collapsedProjectsArray]
  );

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

  // --- Task order state (manual drag order, persisted per project) ---
  const [taskOrderMap, setTaskOrderMap] = useLocalStorage<Record<string, string[]>>(
    TASK_ORDER_KEY,
    {}
  );

  // --- Task sort mode (persisted per project, for checkmark UI) ---
  const [taskSortModeMap, setTaskSortModeMap] = useLocalStorage<Record<string, TaskSortMode>>(
    TASK_SORT_MODE_KEY,
    {}
  );

  /**
   * Called when the user drags a task to a new position.
   * Saves the resulting order as the new manual order for the project.
   */
  const handleReorderTasks = useCallback(
    (projectId: string, newOrder: Task[]) => {
      setTaskOrderMap((prev) => ({ ...prev, [projectId]: newOrder.map((t) => t.id) }));
    },
    [setTaskOrderMap]
  );

  /**
   * Called when the user picks a sort criterion from the picker.
   * Applies the sort to the current task list, saves it as the manual order,
   * and records which mode is active (for the checkmark).
   */
  const handleApplySortCriterion = useCallback(
    (projectId: string, mode: TaskSortMode, currentTasks: Task[]) => {
      const sorted = applySortCriterion(currentTasks, mode);
      setTaskOrderMap((prev) => ({ ...prev, [projectId]: sorted.map((t) => t.id) }));
      setTaskSortModeMap((prev) => ({ ...prev, [projectId]: mode }));
    },
    [setTaskOrderMap, setTaskSortModeMap]
  );

  const {
    activeTask,
    tasksByProjectId,
    archivedTasksByProjectId,
    handleSelectTask: onSelectTask,
    handleStartCreateTaskFromSidebar: onCreateTaskForProject,
    handleRenameTask: onRenameTask,
    handleArchiveTask: onArchiveTask,
    handleRestoreTask: onRestoreTask,
    handleDeleteTask,
    handlePinTask,
  } = useTaskManagementContext();

  const { settings } = useAppSettings();
  const taskHoverAction = settings?.interface?.taskHoverAction ?? 'delete';
  const changelogNotification = useChangelogNotification();
  const changelogEntry = changelogNotification.entry;
  const changelogCardRef = useRef<HTMLDivElement | null>(null);
  const [changelogCardHeight, setChangelogCardHeight] = useState(0);

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

  useEffect(() => {
    const card = changelogCardRef.current;
    if (!card || !changelogNotification.isVisible || !changelogEntry) {
      setChangelogCardHeight(0);
      return;
    }

    const updateHeight = () => {
      setChangelogCardHeight(card.getBoundingClientRect().height);
    };

    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(card);

    return () => observer.disconnect();
  }, [changelogNotification.isVisible, changelogEntry]);

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
            {onGoToMcp && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  className={`min-w-0 ${isMcpView ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
                >
                  <Button
                    variant="ghost"
                    onClick={() => handleNavigationWithCloseSettings(onGoToMcp)}
                    aria-label="MCP Servers"
                    className="w-full justify-start"
                  >
                    <Plug className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
                    <span className="text-sm font-medium">MCP</span>
                  </Button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {automationsEnabled && onGoToAutomations && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  className={`min-w-0 ${isAutomationsView ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
                >
                  <Button
                    variant="ghost"
                    onClick={() => handleNavigationWithCloseSettings(onGoToAutomations)}
                    aria-label="Automations"
                    className="w-full justify-start"
                  >
                    <Timer className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
                    <span className="text-sm font-medium">Automations</span>
                    <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase leading-none tracking-wide text-zinc-600 dark:bg-zinc-400/15 dark:text-zinc-400">
                      Beta
                    </span>
                  </Button>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent className="relative flex min-h-0 flex-col overflow-hidden">
          <div
            className="flex min-h-0 flex-1 flex-col overflow-y-auto"
            style={{
              paddingBottom:
                changelogNotification.isVisible && changelogEntry
                  ? changelogCardHeight + 28
                  : undefined,
            }}
          >
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
                    {(project) => {
                      const typedProject = project as Project;
                      const isProjectActive =
                        selectedProject?.id === typedProject.id && !activeTask;
                      const rawTasks = tasksByProjectId[typedProject.id] ?? [];
                      const manualOrder = taskOrderMap[typedProject.id] ?? [];
                      // If no manual order saved yet, fall back to lastActive sort
                      const displayTasks =
                        manualOrder.length > 0
                          ? applyManualOrder(rawTasks, manualOrder)
                          : applySortCriterion(rawTasks, 'lastActive');
                      const activeSortMode: TaskSortMode =
                        taskSortModeMap[typedProject.id] ?? 'lastActive';

                      return (
                        <SidebarMenuItem>
                          <Collapsible
                            open={!collapsedProjects.has(typedProject.id)}
                            onOpenChange={(isOpen) => {
                              const shouldBeCollapsed = !isOpen;
                              setCollapsedProjectsArray((prev) => {
                                const prevSet = new Set(prev);
                                if (shouldBeCollapsed) {
                                  prevSet.add(typedProject.id);
                                } else {
                                  prevSet.delete(typedProject.id);
                                }
                                return Array.from(prevSet);
                              });
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
                                <ProjectItem project={typedProject} />
                              </motion.button>
                              {/* Sort picker — visible on hover */}
                              <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/project:opacity-100">
                                <SortModePicker
                                  currentMode={activeSortMode}
                                  onSelect={(mode) =>
                                    handleApplySortCriterion(typedProject.id, mode, rawTasks)
                                  }
                                />
                              </span>
                              {onCreateTaskForProject && (
                                <button
                                  type="button"
                                  className="p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-black/5 group-hover/project:opacity-100"
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
                                <ReorderList
                                  as="div"
                                  axis="y"
                                  items={displayTasks}
                                  onReorder={(newOrder) =>
                                    handleReorderTasks(typedProject.id, newOrder as Task[])
                                  }
                                  className="flex min-w-0 flex-col gap-1"
                                  itemClassName="min-w-0"
                                  getKey={(t) => (t as Task).id}
                                >
                                  {(task) => {
                                    const typedTask = task as Task;
                                    const isActive = activeTask?.id === typedTask.id;
                                    return (
                                      <motion.div
                                        whileTap={{ scale: 0.97 }}
                                        onClick={() =>
                                          handleNavigationWithCloseSettings(() =>
                                            onSelectTask?.(typedTask)
                                          )
                                        }
                                        className={`group/task min-w-0 rounded-md py-1.5 pl-1 pr-2 hover:bg-accent ${isActive ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
                                      >
                                        <TaskItem
                                          task={typedTask}
                                          showDelete={true}
                                          showDirectBadge={false}
                                          isPinned={!!typedTask.metadata?.isPinned}
                                          onPin={() => handlePinTask(typedTask)}
                                          onRename={(n) =>
                                            onRenameTask?.(typedProject, typedTask, n)
                                          }
                                          onDelete={() => handleDeleteTask(typedProject, typedTask)}
                                          onArchive={() => onArchiveTask?.(typedProject, typedTask)}
                                          primaryAction={taskHoverAction}
                                          gitPlatform={typedProject.gitPlatform}
                                        />
                                      </motion.div>
                                    );
                                  }}
                                </ReorderList>
                                {(archivedTasksByProjectId[typedProject.id]?.length ?? 0) > 0 && (
                                  <Collapsible className="mt-1">
                                    <CollapsibleTrigger asChild>
                                      <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-black/5">
                                        <Archive className="h-3 w-3 opacity-50" />
                                        <span>
                                          Archived (
                                          {archivedTasksByProjectId[typedProject.id].length})
                                        </span>
                                        <ChevronRight className="ml-auto h-3 w-3 transition-transform group-data-[state=open]/archived:rotate-90" />
                                      </button>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <div className="ml-1.5 space-y-0.5 border-l pl-2">
                                        {archivedTasksByProjectId[typedProject.id].map(
                                          (archivedTask) => (
                                            <div
                                              key={archivedTask.id}
                                              className="group flex min-w-0 items-center justify-between gap-2 px-2 py-1.5 text-muted-foreground"
                                            >
                                              <span className="truncate text-xs font-medium">
                                                {archivedTask.name}
                                              </span>
                                              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                                                <Button
                                                  variant="ghost"
                                                  size="icon-sm"
                                                  onClick={() =>
                                                    onRestoreTask?.(typedProject, archivedTask)
                                                  }
                                                  aria-label={`Unarchive task ${archivedTask.name}`}
                                                >
                                                  <RotateCcw className="h-3 w-3" />
                                                </Button>
                                                <Button
                                                  variant="ghost"
                                                  size="icon-sm"
                                                  onClick={() =>
                                                    handleDeleteTask(typedProject, archivedTask)
                                                  }
                                                  aria-label={`Delete archived task ${archivedTask.name}`}
                                                >
                                                  <Trash2 className="h-3 w-3" />
                                                </Button>
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
          </div>

          {changelogNotification.isVisible && changelogEntry && (
            <div ref={changelogCardRef} className="absolute inset-x-3 bottom-4 z-10">
              <ChangelogNotificationCard
                entry={changelogEntry}
                onOpen={() =>
                  showModal('changelogModal', {
                    entry: changelogEntry,
                  })
                }
                onCreateAccount={() => onOpenAccountSettings?.()}
                onDismiss={changelogNotification.dismiss}
              />
            </div>
          )}
        </SidebarContent>
      </Sidebar>
    </div>
  );
};
