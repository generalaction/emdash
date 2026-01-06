import React from 'react';
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
import { Home, ChevronRight, Plus, FolderOpen, Github } from 'lucide-react';
import ActiveRuns from './ActiveRuns';
import SidebarEmptyState from './SidebarEmptyState';
import { TaskItem } from './TaskItem';
import ProjectDeleteButton from './ProjectDeleteButton';
import type { Project } from '../types/app';
import type { Task } from '../types/chat';

interface LeftSidebarProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onGoHome: () => void;
  onOpenProject?: () => void;
  onNewProject?: () => void;
  onCloneProject?: () => void;
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
  isCreatingTask?: boolean;
  onDeleteTask?: (
    project: Project,
    task: Task,
    options?: { silent?: boolean; deleteRemoteBranch?: boolean }
  ) => void | Promise<void | boolean>;
  onDeleteProject?: (project: Project) => void | Promise<void>;
  isHomeView?: boolean;
}

interface MenuItemButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  ariaLabel: string;
  onClick: () => void;
}

const MenuItemButton: React.FC<MenuItemButtonProps> = ({
  icon: Icon,
  label,
  ariaLabel,
  onClick,
}) => {
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
};

const LeftSidebar: React.FC<LeftSidebarProps> = ({
  projects,
  selectedProject,
  onSelectProject,
  onGoHome,
  onOpenProject,
  onNewProject,
  onCloneProject,
  onSelectTask,
  activeTask,
  onReorderProjects,
  onReorderProjectsFull,
  onSidebarContextChange,
  onCreateTaskForProject,
  isCreatingTask,
  onDeleteTask,
  onDeleteProject,
  isHomeView,
}) => {
  const { open, isMobile, setOpen } = useSidebar();
  const [deletingProjectId, setDeletingProjectId] = React.useState<string | null>(null);

  const handleDeleteProject = React.useCallback(
    async (project: Project) => {
      if (!onDeleteProject) {
        return;
      }
      setDeletingProjectId(project.id);
      try {
        await onDeleteProject(project);
      } finally {
        setDeletingProjectId((current) => (current === project.id ? null : current));
      }
    },
    [onDeleteProject]
  );

  React.useEffect(() => {
    onSidebarContextChange?.({ open, isMobile, setOpen });
  }, [open, isMobile, setOpen, onSidebarContextChange]);

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
                  onClick={onGoHome}
                  aria-label="Home"
                  className="w-full justify-start"
                >
                  <Home className="h-5 w-5 text-muted-foreground sm:h-4 sm:w-4" />
                  <span className="hidden text-sm font-medium sm:inline">Home</span>
                </Button>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <ActiveRuns
            projects={projects}
            onSelectProject={onSelectProject}
            onSelectTask={onSelectTask}
          />

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
                    return (
                      <SidebarMenuItem>
                        <Collapsible defaultOpen className="group/collapsible">
                          <div
                            className={`group/project group/task relative flex w-full min-w-0 items-center rounded-md px-2 py-2 text-sm font-medium focus-within:bg-accent focus-within:text-accent-foreground hover:bg-accent hover:text-accent-foreground ${
                              isProjectActive ? 'bg-black/5 dark:bg-white/5' : ''
                            }`}
                          >
                            <motion.button
                              type="button"
                              whileTap={{ scale: 0.97 }}
                              transition={{ duration: 0.1, ease: 'easeInOut' }}
                              className="flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent pr-7 text-left outline-none focus-visible:outline-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectProject(typedProject);
                              }}
                            >
                              <span className="block w-full truncate">{typedProject.name}</span>
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

                          <CollapsibleContent asChild>
                            <div className="mt-1 flex min-w-0 pl-2">
                              {/* Vertical indent line */}
                              <div className="flex w-4 shrink-0 justify-center py-1">
                                <div className="w-px bg-border" />
                              </div>
                              {/* Task content */}
                              <div className="min-w-0 flex-1">
                                <motion.button
                                  type="button"
                                  whileTap={{ scale: 0.97 }}
                                  transition={{ duration: 0.1, ease: 'easeInOut' }}
                                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/5"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (
                                      onSelectProject &&
                                      selectedProject?.id !== typedProject.id
                                    ) {
                                      onSelectProject(typedProject);
                                    } else if (!selectedProject) {
                                      onSelectProject?.(typedProject);
                                    }
                                    onCreateTaskForProject?.(typedProject);
                                  }}
                                  disabled={isCreatingTask}
                                  aria-label={`Add Task to ${typedProject.name}`}
                                >
                                  <Plus
                                    className="h-3 w-3 flex-shrink-0 text-muted-foreground"
                                    aria-hidden
                                  />
                                  <span className="truncate">Add Task</span>
                                </motion.button>
                                <div className="hidden min-w-0 space-y-0.5 sm:block">
                                  {typedProject.tasks?.map((task) => {
                                    const isActive = activeTask?.id === task.id;
                                    return (
                                      <div
                                        key={task.id}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (
                                            onSelectProject &&
                                            selectedProject?.id !== typedProject.id
                                          ) {
                                            onSelectProject(typedProject);
                                          }
                                          onSelectTask && onSelectTask(task);
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
                                          onDelete={
                                            onDeleteTask
                                              ? (opts) => onDeleteTask(typedProject, task, opts)
                                              : undefined
                                          }
                                        />
                                      </div>
                                    );
                                  })}
                                </div>
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
