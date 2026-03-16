import { ChevronRight, FolderClosed, Loader2, Plus } from 'lucide-react';
import React, { useEffect, useMemo } from 'react';
import { LocalProject, SshProject } from '@shared/projects';
import { Task } from '@shared/tasks';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { useNavigate, useParams, useWorkspaceSlots } from '@renderer/core/view/navigation-provider';
import { useTasksContext } from '@renderer/features/tasks/tasks-provider';
import { usePrefetchRepository } from '@renderer/hooks/use-repository';
import { cn } from '@renderer/lib/utils';
import {
  PendingTask,
  usePendingTasksContext,
} from '@renderer/views/projects/pending-tasks-provider';
import { PendingProject } from '../add-project-modal/pending-projects-provider';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { ProjectItem } from './left-sidebar';
import { SidebarItemMiniButton, SidebarMenuButton, SidebarMenuRow } from './sidebar-primitives';
import { useSidebarContext } from './sidebar-provider';
import { SidebarTaskItem } from './task-item';

const STAGE_LABEL: Record<PendingProject['stage'], string> = {
  'creating-repo': 'Creating repository…',
  cloning: 'Cloning…',
  initializing: 'Initializing…',
  registering: 'Registering…',
  error: 'Failed',
};

export type TaskItem =
  | {
      status: 'ready';
      data: Task;
    }
  | {
      status: 'pending';
      data: PendingTask;
    };

export function SidebarProjectItem({ project }: { project: ProjectItem }) {
  const { forceOpenIds, setForceOpenIds } = useSidebarContext();
  const { activeTasksByProjectId: tasksByProjectId } = useTasksContext();
  const { pendingTasksByProjectId } = usePendingTasksContext();
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params: projectParams } = useParams('project');
  const { params: taskParams } = useParams('task');

  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : null;
  const currentTaskId = currentView === 'task' ? taskParams.taskId : null;

  const isProjectActive = useMemo(
    () => currentProjectId === project.data.id && !currentTaskId,
    [currentProjectId, currentTaskId, project.data.id]
  );

  const { prefetch: prefetchRepository } = usePrefetchRepository(project.data.id);

  useEffect(() => {
    if (isProjectActive) {
      prefetchRepository();
    }
  }, [isProjectActive, prefetchRepository]);

  const showCreateTaskModal = useShowModal('taskModal');

  const tasks = useMemo(
    () => tasksByProjectId[project.data.id] ?? [],
    [tasksByProjectId, project.data.id]
  );

  const allTasks = useMemo(() => {
    const readyTasks: TaskItem[] = tasks.map((t) => ({
      status: 'ready',
      data: t,
    }));
    const readyIds = new Set(tasks.map((t) => t.id));
    const pendingTasks: TaskItem[] = (pendingTasksByProjectId[project.data.id] ?? [])
      .filter((t) => !readyIds.has(t.id))
      .map((t) => ({ status: 'pending', data: t }));
    return [...pendingTasks, ...readyTasks];
  }, [tasks, pendingTasksByProjectId, project.data.id]);

  const renderSpinnerWithTooltip = () => {
    return (
      <Tooltip>
        <TooltipTrigger>
          <SidebarItemMiniButton type="button" disabled aria-label="Loading">
            <Loader2 className="h-4 w-4 animate-spin text-foreground/60" />
          </SidebarItemMiniButton>
        </TooltipTrigger>
        <TooltipContent>{STAGE_LABEL[(project.data as PendingProject).stage]}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <Collapsible
      defaultOpen
      open={forceOpenIds.has(project.data.id) ? true : undefined}
      onOpenChange={() => {
        if (forceOpenIds.has(project.data.id)) {
          setForceOpenIds((s) => {
            const n = new Set(s);
            n.delete(project.data.id);
            return n;
          });
        }
      }}
      className="group/collapsible w-full"
    >
      <SidebarMenuRow className="group/row justify-between flex p-1.5" isActive={isProjectActive}>
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {project.status === 'creating' ? (
            renderSpinnerWithTooltip()
          ) : (
            <CollapsibleTrigger
              className="group/trigger"
              render={
                <SidebarItemMiniButton type="button" className="relative">
                  <FolderClosed className="absolute h-4 w-4 text-foreground/60 transition-opacity duration-150 opacity-100 group-hover/row:opacity-0" />
                  <ChevronRight className="absolute h-4 w-4 text-foreground/60 transition-all duration-150 opacity-0 group-hover/row:opacity-100 group-data-[panel-open]/trigger:rotate-90" />
                </SidebarItemMiniButton>
              }
            />
          )}
          <button
            className="flex-1 min-w-0 self-stretch flex items-center truncate text-left"
            onClick={() => navigate('project', { projectId: project.data.id })}
          >
            {project.data.name}
          </button>
        </div>
        <SidebarItemMiniButton
          type="button"
          className={'opacity-0 group-hover/row:opacity-100 transition-opacity duration-150'}
          onPointerEnter={() => prefetchRepository()}
          onClick={() =>
            showCreateTaskModal({
              projectId: project.data.id,
              projectPath: (project.data as LocalProject | SshProject).path,
            })
          }
          disabled={project.status === 'creating'}
        >
          <Plus className="h-4 w-4" />
        </SidebarItemMiniButton>
      </SidebarMenuRow>
      <CollapsibleContent className=" min-w-0 data-open:mt-0.5 data-closed:mt-0 data-closed:hidden">
        <div className="flex min-w-0 flex-col gap-0.5 ">
          {allTasks.map((task) => (
            <SidebarTaskItem
              key={task.data.id}
              task={task}
              isActive={currentTaskId === task.data.id}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface BaseProjectItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  isActive: boolean;
}

export function BaseProjectItem({ isActive, className, ...props }: BaseProjectItemProps) {
  return (
    <SidebarMenuButton
      className={cn('justify-between flex item px-1 py-1', className)}
      isActive={isActive}
      {...props}
    />
  );
}
