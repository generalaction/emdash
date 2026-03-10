import { motion } from 'framer-motion';
import { Archive, ChevronRight, FolderClosed, FolderOpen, Plus, RotateCcw } from 'lucide-react';
import React from 'react';
import type { ConnectionState } from '@renderer/components/ssh';
import { RemoteProjectIndicator } from '@renderer/components/ssh/RemoteProjectIndicator';
import { TaskDeleteButton } from '@renderer/components/TaskDeleteButton';
import { Button } from '@renderer/components/ui/button';
import { useAppSettings } from '@renderer/contexts/AppSettingsProvider';
import { useTaskManagementContext } from '@renderer/contexts/TaskManagementProvider';
import {
  useWorkspaceNavigation,
  useWorkspaceWrapParams,
} from '@renderer/contexts/WorkspaceNavigationContext';
import { useRemoteProject } from '@renderer/hooks/useRemoteProject';
import type { Project } from '@renderer/types/app';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { SidebarMenuItem } from '../ui/sidebar';
import { useSidebarContext } from './SidebarProvider';
import { SidebarTaskItem } from './SidebarTaskItem';

const isRemoteProject = (project: Project): boolean => {
  return Boolean(project.isRemote || project.sshConnectionId);
};

const getConnectionId = (project: Project): string | null => {
  return project.sshConnectionId || null;
};

interface ProjectNameContentProps {
  project: Project;
}

const ProjectNameContent = React.memo<ProjectNameContentProps>(({ project }) => {
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
ProjectNameContent.displayName = 'ProjectNameContent';

interface SidebarProjectItemProps {
  project: Project;
}

export const SidebarProjectItem = React.memo<SidebarProjectItemProps>(({ project }) => {
  const { forceOpenIds, setForceOpenIds, pinnedTaskIds } = useSidebarContext();
  const {
    tasksByProjectId,
    archivedTasksByProjectId,
    handleStartCreateTaskFromSidebar: onCreateTaskForProject,
    handleDeleteTask,
    handleRestoreTask: onRestoreTask,
  } = useTaskManagementContext();
  const { navigate } = useWorkspaceNavigation();
  const { wrapParams } = useWorkspaceWrapParams();
  const currentProjectId = wrapParams.projectId as string | null;
  const currentTaskId = wrapParams.taskId as string | null;
  const { settings } = useAppSettings();
  const taskHoverAction = settings?.interface?.taskHoverAction ?? 'delete';

  const isProjectActive = currentProjectId === project.id && !currentTaskId;
  const tasks = tasksByProjectId[project.id] ?? [];
  const archivedTasks = archivedTasksByProjectId[project.id] ?? [];

  const sortedTasks = tasks
    .slice()
    .sort((a, b) => (pinnedTaskIds.has(b.id) ? 1 : 0) - (pinnedTaskIds.has(a.id) ? 1 : 0));

  return (
    <SidebarMenuItem>
      <Collapsible
        defaultOpen
        open={forceOpenIds.has(project.id) ? true : undefined}
        onOpenChange={() => {
          if (forceOpenIds.has(project.id)) {
            setForceOpenIds((s) => {
              const n = new Set(s);
              n.delete(project.id);
              return n;
            });
          }
        }}
        className="group/collapsible"
      >
        <div
          className={`group/project relative flex w-full min-w-0 items-center gap-1.5 rounded-md py-1.5 pl-1 pr-1 text-sm font-medium hover:bg-accent ${isProjectActive ? 'bg-black/[0.06] dark:bg-white/[0.08]' : ''}`}
        >
          <CollapsibleTrigger>
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
            onClick={() => navigate('project', { projectId: project.id })}
          >
            <ProjectNameContent project={project} />
          </motion.button>
          {onCreateTaskForProject && (
            <button
              type="button"
              className="p-0.5 text-muted-foreground hover:bg-black/5"
              onClick={() => onCreateTaskForProject(project)}
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>

        <CollapsibleContent className="mt-1 min-w-0 data-[state=closed]:hidden">
          <div className="flex min-w-0 flex-col gap-1">
            {sortedTasks.map((task) => (
              <SidebarTaskItem
                key={task.id}
                task={task}
                project={project}
                isActive={currentTaskId === task.id}
                taskHoverAction={taskHoverAction}
              />
            ))}
            {archivedTasks.length > 0 && (
              <Collapsible className="mt-1">
                <CollapsibleTrigger>
                  <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-black/5">
                    <Archive className="h-3 w-3 opacity-50" />
                    <span>Archived ({archivedTasks.length})</span>
                    <ChevronRight className="ml-auto h-3 w-3 transition-transform group-data-[state=open]/archived:rotate-90" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="ml-1.5 space-y-0.5 border-l pl-2">
                    {archivedTasks.map((archivedTask) => (
                      <div
                        key={archivedTask.id}
                        className="flex min-w-0 items-center justify-between gap-2 px-2 py-1.5 text-muted-foreground"
                      >
                        <span className="truncate text-xs font-medium">{archivedTask.name}</span>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onRestoreTask?.(project, archivedTask)}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </Button>
                          <TaskDeleteButton
                            taskName={archivedTask.name}
                            taskId={archivedTask.id}
                            taskPath={archivedTask.path}
                            useWorktree={archivedTask.useWorktree !== false}
                            onConfirm={() => handleDeleteTask(project, archivedTask)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
});
SidebarProjectItem.displayName = 'SidebarProjectItem';
