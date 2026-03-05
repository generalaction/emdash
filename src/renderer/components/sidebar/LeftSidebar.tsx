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
  Archive,
  RotateCcw,
  ChevronRight,
} from 'lucide-react';
import SidebarEmptyState from '../SidebarEmptyState';
import { TaskItem } from '../TaskItem';
import { TaskDeleteButton } from '../TaskDeleteButton';
import { RemoteProjectIndicator } from '../ssh/RemoteProjectIndicator';
import { useRemoteProject } from '../../hooks/useRemoteProject';
import type { Project } from '../../types/app';
import type { Task } from '../../types/chat';
import type { ConnectionState } from '../ssh';
import { useProjectManagementContext } from '../../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../../contexts/TaskManagementContext';
import { useAppSettings } from '../../contexts/AppSettingsProvider';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { ProjectsGroupLabel } from './ProjectsGroupLabel';

const PINNED_TASKS_KEY = 'emdash-pinned-tasks';
const PROJECT_ORDER_KEY = 'sidebarProjectOrder';

interface LeftSidebarProps {
  onSidebarContextChange?: (state: {
    open: boolean;
    isMobile: boolean;
    setOpen: (next: boolean) => void;
  }) => void;
  onCloseSettingsPage?: () => void;
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

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  onSidebarContextChange,
  onCloseSettingsPage,
}) => {
  const { open, isMobile, setOpen } = useSidebar();
  const {
    projects,
    selectedProject,
    showHomeView: isHomeView,
    showSkillsView: isSkillsView,
    handleSelectProject: onSelectProject,
    handleGoHome: onGoHome,
    handleOpenProject: onOpenProject,
    handleGoToSkills: onGoToSkills,
  } = useProjectManagementContext();

  // --- Project order (localStorage only — context holds raw DB order) ---
  const [projectOrder, setProjectOrder] = useLocalStorage<string[]>(PROJECT_ORDER_KEY, []);

  const sortedProjects = useMemo(() => {
    if (!projectOrder.length) return projects;
    return [...projects].sort((a, b) => {
      const ai = projectOrder.indexOf(a.id);
      const bi = projectOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0; // both new → keep relative DB order
      if (ai === -1) return -1; // a is new → float to top
      if (bi === -1) return 1; // b is new → float to top
      return ai - bi;
    });
  }, [projects, projectOrder]);

  const handleReorderProjects = useCallback(
    (newOrder: Project[]) => {
      setProjectOrder(newOrder.map((p) => p.id));
    },
    [setProjectOrder]
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
  } = useTaskManagementContext();

  const { settings } = useAppSettings();
  const taskHoverAction = settings?.interface?.taskHoverAction ?? 'delete';

  const [pinnedTaskIdsArray, setPinnedTaskIdsArray] = useLocalStorage<string[]>(
    PINNED_TASKS_KEY,
    []
  );
  const pinnedTaskIds = useMemo(() => new Set(pinnedTaskIdsArray), [pinnedTaskIdsArray]);

  const handlePinTask = useCallback(
    (task: Task) => {
      setPinnedTaskIdsArray((prev) =>
        prev.includes(task.id) ? prev.filter((id) => id !== task.id) : [...prev, task.id]
      );
    },
    [setPinnedTaskIdsArray]
  );

  // Remove pinned IDs for tasks that no longer exist (deleted or archived)
  useEffect(() => {
    if (!pinnedTaskIdsArray.length) return;
    const allActiveIds = new Set(
      Object.values(tasksByProjectId)
        .flat()
        .map((t) => t.id)
    );
    const cleaned = pinnedTaskIdsArray.filter((id) => allActiveIds.has(id));
    if (cleaned.length !== pinnedTaskIdsArray.length) {
      setPinnedTaskIdsArray(cleaned);
    }
  }, [tasksByProjectId, pinnedTaskIdsArray, setPinnedTaskIdsArray]);

  const [forceOpenIds, setForceOpenIds] = useState<Set<string>>(new Set());
  const prevTaskCountsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const prev = prevTaskCountsRef.current;
    for (const project of projects) {
      const taskCount = tasksByProjectId[project.id]?.length ?? 0;
      const prevCount = prev.get(project.id) ?? 0;
      if (prevCount === 0 && taskCount > 0) {
        setForceOpenIds((s) => new Set(s).add(project.id));
      }
      prev.set(project.id, taskCount);
    }
  }, [projects, tasksByProjectId]);

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
                              <ProjectItem project={typedProject} />
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
                              {(tasksByProjectId[typedProject.id] ?? [])
                                .slice()
                                .sort(
                                  (a, b) =>
                                    (pinnedTaskIds.has(b.id) ? 1 : 0) -
                                    (pinnedTaskIds.has(a.id) ? 1 : 0)
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
                                        isPinned={pinnedTaskIds.has(task.id)}
                                        onPin={() => handlePinTask(task)}
                                        onRename={(n) => onRenameTask?.(typedProject, task, n)}
                                        onDelete={() => handleDeleteTask(typedProject, task)}
                                        onArchive={() => onArchiveTask?.(typedProject, task)}
                                        primaryAction={taskHoverAction}
                                      />
                                    </motion.div>
                                  );
                                })}
                              {(archivedTasksByProjectId[typedProject.id]?.length ?? 0) > 0 && (
                                <Collapsible className="mt-1">
                                  <CollapsibleTrigger asChild>
                                    <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-black/5">
                                      <Archive className="h-3 w-3 opacity-50" />
                                      <span>
                                        Archived ({archivedTasksByProjectId[typedProject.id].length}
                                        )
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
                                                  onRestoreTask?.(typedProject, archivedTask)
                                                }
                                              >
                                                <RotateCcw className="h-3 w-3" />
                                              </Button>
                                              <TaskDeleteButton
                                                taskName={archivedTask.name}
                                                taskId={archivedTask.id}
                                                taskPath={archivedTask.path}
                                                useWorktree={archivedTask.useWorktree !== false}
                                                onConfirm={() =>
                                                  handleDeleteTask(typedProject, archivedTask)
                                                }
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
