import { Archive, ChevronRight, FolderClosed, FolderOpen, Plus, RotateCcw } from 'lucide-react';
import React from 'react';
import type { ConnectionState } from '@renderer/components/ssh';
import { RemoteProjectIndicator } from '@renderer/components/ssh/RemoteProjectIndicator';
import { TaskDeleteButton } from '@renderer/components/TaskDeleteButton';
import { Button } from '@renderer/components/ui/button';
import { useAppSettings } from '@renderer/contexts/AppSettingsProvider';
import { useTaskManagementContext } from '@renderer/contexts/TasksProvider';
import {
  useWorkspaceNavigation,
  useWorkspaceWrapParams,
} from '@renderer/contexts/WorkspaceNavigationContext';
import { useRemoteProject } from '@renderer/hooks/useRemoteProject';
import { cn } from '@renderer/lib/utils';
import type { Project } from '@renderer/types/app';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { SidebarMenuItem } from './sidebar-primitives';
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
    return <div className="min-w-0 truncate">{project.name}</div>;
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex-1 truncate">{project.name}</span>
      {connectionId && (
        <RemoteProjectIndicator
          host={remote.host || undefined}
          connectionState={remote.connectionState as ConnectionState}
          size="md"
          onReconnect={remote.reconnect}
          disabled={remote.isLoading}
        />
      )}
    </div>
  );
});
ProjectNameContent.displayName = 'ProjectNameContent';

interface SidebarProjectItemProps {
  project: Project;
}

const SidebarItemMiniButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'w-7 h-7 flex items-center justify-center hover:bg-accent-layer rounded-md',
      className
    )}
    {...props}
  />
));

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
    <SidebarMenuItem className="justify-between flex item px-1 py-1" isActive={isProjectActive}>
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
        className="group/collapsible w-full"
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-1 min-w-0 items-stretch gap-1">
            <CollapsibleTrigger className="flex-0">
              <SidebarItemMiniButton type="button">
                <FolderOpen className="hidden h-4 w-4 text-foreground/60 group-data-[state=open]/collapsible:block" />
                <FolderClosed className="block h-4 w-4 text-foreground/60 group-data-[state=open]/collapsible:hidden" />
              </SidebarItemMiniButton>
            </CollapsibleTrigger>
            <button
              type="button"
              className="min-w-0 flex-1 flex items-center overflow-hidden text-left"
              onClick={() => navigate('project', { projectId: project.id })}
            >
              <ProjectNameContent project={project} />
            </button>
          </div>
          <SidebarItemMiniButton
            type="button"
            className="p-0.5 text-muted-foreground hover:bg-black/5"
            onClick={() => onCreateTaskForProject(project)}
          >
            <Plus className="h-4 w-4" />
          </SidebarItemMiniButton>
        </div>
        <CollapsibleContent className=" min-w-0 data-[state=closed]:hidden">
          <div className="flex min-w-0 flex-col gap-1 data-[state=open]:mt-1">
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
