import React, { useCallback, useEffect, useRef } from 'react';
import ReorderList from './ReorderList';
import { Button } from './ui/button';
import { log } from '../lib/logger';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar,
} from './ui/sidebar';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import {
  Home,
  ChevronDown,
  Plus,
  FolderOpen,
  MessageSquare,
  Settings as SettingsIcon,
  Command,
} from 'lucide-react';
import ActiveRuns from './ActiveRuns';
import SidebarEmptyState from './SidebarEmptyState';
import GithubStatus from './GithubStatus';
import { TaskItem } from './TaskItem';
import ProjectDeleteButton from './ProjectDeleteButton';
import FeedbackModal from './FeedbackModal';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import type { Project } from '../types/app';
import type { Task } from '../types/chat';

interface LeftSidebarProps {
  projects: Project[];
  selectedProject: Project | null;
  onSelectProject: (project: Project) => void;
  onGoHome: () => void;
  onOpenProject?: () => void;
  onNewProject?: () => void;
  onSelectTask?: (task: Task) => void;
  activeTask?: Task | null;
  onReorderProjects?: (sourceId: string, targetId: string) => void;
  onReorderProjectsFull?: (newOrder: Project[]) => void;
  githubInstalled?: boolean;
  githubAuthenticated?: boolean;
  githubUser?: {
    login?: string;
    name?: string;
    avatar_url?: string;
    html_url?: string;
    email?: string;
  } | null;
  onGithubConnect?: () => void;
  githubLoading?: boolean;
  githubStatusMessage?: string;
  githubInitialized?: boolean;
  onSidebarContextChange?: (state: {
    open: boolean;
    isMobile: boolean;
    setOpen: (next: boolean) => void;
  }) => void;
  onCreateTaskForProject?: (project: Project) => void;
  isCreatingTask?: boolean;
  onDeleteTask?: (project: Project, task: Task) => void | Promise<void | boolean>;
  onDeleteProject?: (project: Project) => void | Promise<void>;
  isHomeView?: boolean;
  onToggleSettings?: () => void;
  isSettingsOpen?: boolean;
  isFeedbackOpen?: boolean;
  onOpenFeedback?: () => void;
  onCloseFeedback?: () => void;
}

const LeftSidebar: React.FC<LeftSidebarProps> = ({
  projects,
  selectedProject,
  onSelectProject,
  onGoHome,
  onOpenProject,
  onNewProject,
  onSelectTask,
  activeTask,
  onReorderProjects,
  onReorderProjectsFull,
  githubInstalled = true,
  githubAuthenticated = false,
  githubUser,
  onGithubConnect,
  githubLoading = false,
  githubStatusMessage,
  githubInitialized = false,
  onSidebarContextChange,
  onCreateTaskForProject,
  isCreatingTask,
  onDeleteTask,
  onDeleteProject,
  isHomeView,
  onToggleSettings,
  isSettingsOpen = false,
  isFeedbackOpen = false,
  onOpenFeedback,
  onCloseFeedback,
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

  const githubProfileUrl = React.useMemo(() => {
    if (!githubAuthenticated) {
      return null;
    }
    const login = githubUser?.login?.trim();
    return login ? `https://github.com/${login}` : null;
  }, [githubAuthenticated, githubUser?.login]);

  const handleGithubProfileClick = React.useCallback(() => {
    if (!githubProfileUrl || typeof window === 'undefined') {
      return;
    }
    const api = (window as any).electronAPI;
    api?.openExternal?.(githubProfileUrl);
  }, [githubProfileUrl]);

  React.useEffect(() => {
    onSidebarContextChange?.({ open, isMobile, setOpen });
  }, [open, isMobile, setOpen, onSidebarContextChange]);

  const feedbackButtonRef = useRef<HTMLButtonElement | null>(null);

  // Broadcast overlay state so the preview pane can hide while feedback is open
  useEffect(() => {
    try {
      const open = Boolean(isFeedbackOpen);
      window.dispatchEvent(new CustomEvent('emdash:overlay:changed', { detail: { open } }));
    } catch (error) {
      log.error('Failed to broadcast overlay state change', error);
    }
  }, [isFeedbackOpen]);

  const handleFeedbackButtonClick = useCallback(() => {
    onOpenFeedback?.();
  }, [onOpenFeedback]);

  const handleFeedbackClose = useCallback(() => {
    onCloseFeedback?.();
    feedbackButtonRef.current?.blur();
  }, [onCloseFeedback]);

  const renderGithubStatus = () => (
    <GithubStatus
      installed={githubInstalled}
      authenticated={githubAuthenticated}
      user={githubUser}
      onConnect={onGithubConnect}
      isLoading={githubLoading}
      statusMessage={githubStatusMessage}
      isInitialized={githubInitialized}
    />
  );

  return (
    <div className="relative h-full">
      <Sidebar className="!w-full lg:border-r-0">
        <SidebarContent>
          <SidebarGroup className="mb-3">
            <SidebarGroupContent>
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
                      <Home className="h-5 w-5 text-gray-600 dark:text-gray-400 sm:h-4 sm:w-4" />
                      <span className="hidden text-sm font-medium sm:inline">Home</span>
                    </Button>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

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
                            className={`group/project group/task flex w-full min-w-0 items-center rounded-md px-2 py-2 text-sm font-medium focus-within:bg-accent focus-within:text-accent-foreground hover:bg-accent hover:text-accent-foreground ${
                              isProjectActive ? 'bg-black/5 dark:bg-white/5' : ''
                            }`}
                          >
                            <button
                              type="button"
                              className="flex min-w-0 flex-1 flex-col bg-transparent text-left outline-none focus-visible:outline-none"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectProject(typedProject);
                              }}
                            >
                              <span className="block truncate">{typedProject.name}</span>
                              <span className="hidden truncate text-xs text-muted-foreground sm:block">
                                {typedProject.githubInfo?.repository || typedProject.path}
                              </span>
                            </button>
                            <div className="relative flex flex-shrink-0 items-center pl-6">
                              {showProjectDelete ? (
                                <ProjectDeleteButton
                                  projectName={typedProject.name}
                                  tasks={typedProject.tasks || []}
                                  onConfirm={() => handleDeleteProject(typedProject)}
                                  isDeleting={isDeletingProject}
                                  aria-label={`Delete project ${typedProject.name}`}
                                  className={`absolute left-0 inline-flex h-5 w-5 items-center justify-center rounded p-0.5 text-muted-foreground opacity-0 transition-opacity duration-150 hover:bg-muted focus:opacity-100 focus-visible:opacity-100 focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-100 ${
                                    isDeletingProject
                                      ? 'opacity-100'
                                      : 'group-hover/task:opacity-100'
                                  }`}
                                />
                              ) : null}
                              <CollapsibleTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={`Toggle tasks for ${typedProject.name}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex h-5 w-5 items-center justify-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                >
                                  <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]/collapsible:rotate-180" />
                                </button>
                              </CollapsibleTrigger>
                            </div>
                          </div>

                          <CollapsibleContent asChild>
                            <div className="ml-7 mt-2 min-w-0">
                              <div className="bg-sidebar pb-1">
                                <button
                                  type="button"
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
                                    className="h-3 w-3 flex-shrink-0 text-gray-400"
                                    aria-hidden
                                  />
                                  <span className="truncate">Add Task</span>
                                </button>
                              </div>
                              <div className="hidden min-w-0 space-y-1 sm:block">
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
                                        onDelete={
                                          onDeleteTask
                                            ? () => onDeleteTask(typedProject, task)
                                            : undefined
                                        }
                                      />
                                    </div>
                                  );
                                })}
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
                    <SidebarMenuButton asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-1 w-full justify-start"
                        onClick={onOpenProject}
                      >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        <span className="text-sm font-medium">Add Project</span>
                      </Button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter className="min-w-0 overflow-hidden border-t border-gray-200 px-2 py-2 dark:border-gray-800 sm:px-3 sm:py-3">
          <div className="flex w-full items-center justify-between gap-2">
            {/* Left: GitHub Status */}
            <div
              className={`flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5 ${
                githubProfileUrl ? 'cursor-pointer' : 'cursor-default'
              }`}
              onClick={(e) => {
                if (!githubProfileUrl) {
                  return;
                }
                e.preventDefault();
                handleGithubProfileClick();
              }}
              tabIndex={githubProfileUrl ? 0 : -1}
              role={githubProfileUrl ? 'button' : undefined}
              aria-label={githubProfileUrl ? 'Open GitHub profile' : undefined}
            >
              {renderGithubStatus()}
            </div>

            {/* Right: Feedback & Settings Buttons */}
            <div className="flex items-center gap-1">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Open feedback"
                      onClick={handleFeedbackButtonClick}
                      ref={feedbackButtonRef}
                      className="h-8 w-8 text-muted-foreground hover:bg-background/80"
                    >
                      <MessageSquare className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs font-medium">
                    <div className="flex flex-col gap-1">
                      <span>Open feedback</span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Command className="h-3 w-3" aria-hidden="true" />
                        <span>⇧</span>
                        <span>F</span>
                      </span>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {onToggleSettings && (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={isSettingsOpen ? 'secondary' : 'ghost'}
                        size="icon"
                        aria-label="Open settings"
                        aria-pressed={isSettingsOpen}
                        onClick={async () => {
                          void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
                            captureTelemetry('toolbar_settings_clicked');
                          });
                          onToggleSettings();
                        }}
                        className="h-8 w-8 text-muted-foreground hover:bg-background/80"
                      >
                        <SettingsIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs font-medium">
                      <div className="flex flex-col gap-1">
                        <span>Open settings</span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <Command className="h-3 w-3" aria-hidden="true" />
                          <span>,</span>
                        </span>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <FeedbackModal
        isOpen={isFeedbackOpen}
        onClose={handleFeedbackClose}
        githubUser={githubUser}
      />
    </div>
  );
};

export default LeftSidebar;
