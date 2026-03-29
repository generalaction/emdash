import { ChevronRight, FolderClosed, Loader2, Plus, Trash2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useEffect } from 'react';
import ReorderList from '@renderer/components/reorder-list';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/components/ui/context-menu';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { usePrefetchRepository } from '@renderer/core/projects/use-repository';
import {
  isUnregisteredProject,
  MountedProject,
  ProjectStore,
  UnregisteredProject,
} from '@renderer/core/stores/project';
import { projectManagerStore } from '@renderer/core/stores/project-manager';
import { getProjectStore, projectViewKind } from '@renderer/core/stores/project-selectors';
import { sidebarStore } from '@renderer/core/stores/sidebar-store';
import { useNavigate, useParams, useWorkspaceSlots } from '@renderer/core/view/navigation-provider';
import { cn } from '@renderer/lib/utils';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { SidebarItemMiniButton, SidebarMenuButton, SidebarMenuRow } from './sidebar-primitives';
import { SidebarTaskItem } from './task-item';

const UNREGISTERED_PHASE_LABEL: Record<UnregisteredProject['phase'], string> = {
  'creating-repo': 'Creating repository…',
  cloning: 'Cloning…',
  registering: 'Registering…',
  error: 'Failed',
};

const TaskList = observer(function TaskList({
  taskManager,
  projectId,
}: {
  taskManager: MountedProject['taskManager'];
  projectId: string;
}) {
  const { currentView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const currentTaskId = currentView === 'task' ? taskParams.taskId : null;

  const tasks = Array.from(taskManager.tasks.values()).filter(
    (t) => t.state === 'unregistered' || !('archivedAt' in t.data && t.data.archivedAt)
  );

  const orderedTasks = sidebarStore.mergeTaskOrder(projectId, tasks);

  return (
    <ReorderList
      as="div"
      axis="y"
      items={orderedTasks}
      onReorder={(newOrder) =>
        sidebarStore.setTaskOrder(
          projectId,
          newOrder.map((t) => t.data.id)
        )
      }
      className="m-0 flex min-w-0 list-none flex-col gap-0.5 p-0"
      itemClassName="relative list-none min-w-0 cursor-pointer"
      getKey={(task) => task.data.id}
    >
      {(task) => (
        <SidebarTaskItem
          task={task}
          projectId={projectId}
          isActive={currentTaskId === task.data.id}
        />
      )}
    </ReorderList>
  );
});

export const SidebarProjectItem = observer(function SidebarProjectItem({
  project,
}: {
  project: ProjectStore;
}) {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params: projectParams } = useParams('project');
  const { params: taskParams } = useParams('task');
  const showCreateTaskModal = useShowModal('taskModal');
  const showConfirm = useShowModal('confirmActionModal');

  const projectId = project.state === 'unregistered' ? project.id : project.data!.id;
  const projectName = project.name;

  const { prefetch: prefetchRepository } = usePrefetchRepository(projectId);

  const currentProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : null;
  const currentTaskId = currentView === 'task' ? taskParams.taskId : null;

  const isProjectActive = currentProjectId === projectId && !currentTaskId;

  useEffect(() => {
    if (isProjectActive) prefetchRepository();
  }, [isProjectActive, prefetchRepository]);

  const forceOpen = sidebarStore.forceOpenIds.has(projectId);
  const isUnregistered = project.state === 'unregistered';

  const handleDelete = () =>
    showConfirm({
      title: 'Delete project',
      description: `"${projectName}" and all its tasks will be permanently deleted. This action cannot be undone.`,
      confirmLabel: 'Delete',
      onSuccess: () => {
        if (currentProjectId === projectId) {
          const firstOther = Array.from(projectManagerStore.projects.keys()).find(
            (id) => id !== projectId
          );
          if (firstOther) {
            navigate('project', { projectId: firstOther });
          } else {
            navigate('home');
          }
        }
        void projectManagerStore.deleteProject(projectId);
      },
    });

  const renderSpinnerWithTooltip = () => {
    if (!isUnregisteredProject(project)) return null;
    const label = UNREGISTERED_PHASE_LABEL[project.phase] ?? 'Loading…';
    return (
      <Tooltip>
        <TooltipTrigger>
          <SidebarItemMiniButton type="button" disabled aria-label="Loading">
            <Loader2 className="h-4 w-4 animate-spin text-foreground/60" />
          </SidebarItemMiniButton>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <Collapsible
          defaultOpen
          open={forceOpen ? true : undefined}
          onOpenChange={() => {
            if (forceOpen) sidebarStore.clearForceOpen(projectId);
          }}
          className="group/collapsible w-full"
        >
          <SidebarMenuRow
            className={cn('group/row justify-between flex p-1.5')}
            data-active={isProjectActive || undefined}
            isActive={isProjectActive}
          >
            <div className="flex items-center gap-1 flex-1 min-w-0">
              {project.state === 'unregistered' ? (
                renderSpinnerWithTooltip()
              ) : (
                <CollapsibleTrigger
                  className="group/trigger"
                  render={
                    <SidebarItemMiniButton type="button" className="relative">
                      <FolderClosed className="absolute h-4 w-4 transition-opacity duration-150 opacity-100 group-hover/row:opacity-0" />
                      <ChevronRight className="absolute h-4 w-4 transition-all duration-150 opacity-0 group-hover/row:opacity-100 group-data-panel-open/trigger:rotate-90" />
                    </SidebarItemMiniButton>
                  }
                />
              )}
              <button
                className={cn(
                  'flex-1 min-w-0 self-stretch flex items-center truncate text-left transition-colors',
                  projectViewKind(getProjectStore(projectId)) === 'bootstrapping' &&
                    'text-foreground-tertiary-passive'
                )}
                onClick={() => navigate('project', { projectId })}
              >
                {projectName}
              </button>
            </div>
            <SidebarItemMiniButton
              type="button"
              className={'opacity-0 group-hover/row:opacity-100 transition-opacity duration-150'}
              onPointerEnter={() => prefetchRepository()}
              onClick={() => showCreateTaskModal({ projectId })}
              disabled={project.state === 'unregistered'}
            >
              <Plus className="h-4 w-4" />
            </SidebarItemMiniButton>
          </SidebarMenuRow>
          <CollapsibleContent className=" min-w-0 data-open:mt-0.5 data-closed:mt-0 data-closed:hidden">
            {project.state === 'mounted' && (
              <TaskList
                taskManager={(project as MountedProject).taskManager}
                projectId={projectId}
              />
            )}
          </CollapsibleContent>
        </Collapsible>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onClick={handleDelete} disabled={isUnregistered}>
          <Trash2 className="size-4" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

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
