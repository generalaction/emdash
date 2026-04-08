import { ChevronRight, FolderClosed, Loader2, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useEffect } from 'react';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { usePrefetchRepository } from '@renderer/core/projects/use-repository';
import { sidebarStore } from '@renderer/core/stores/app-state';
import { isUnregisteredProject, UnregisteredProject } from '@renderer/core/stores/project';
import { getProjectStore, projectViewKind } from '@renderer/core/stores/project-selectors';
import { useNavigate, useParams, useWorkspaceSlots } from '@renderer/core/view/navigation-provider';
import { cn } from '@renderer/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { SidebarItemMiniButton, SidebarMenuButton, SidebarMenuRow } from './sidebar-primitives';

const UNREGISTERED_PHASE_LABEL: Record<UnregisteredProject['phase'], string> = {
  'creating-repo': 'Creating repository…',
  cloning: 'Cloning…',
  registering: 'Registering…',
  error: 'Failed',
};

export const SidebarProjectItem = observer(function SidebarProjectItem({
  projectId,
}: {
  projectId: string;
}) {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const { params: projectParams } = useParams('project');
  const { params: taskParams } = useParams('task');
  const showCreateTaskModal = useShowModal('taskModal');

  const project = getProjectStore(projectId);

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

  const isExpanded = sidebarStore.expandedProjectIds.has(projectId);

  if (!project) return null;

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
    <SidebarMenuRow
      className={cn('group/row h-8 justify-between flex px-1')}
      data-active={isProjectActive || undefined}
      isActive={isProjectActive}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => navigate('project', { projectId })}
    >
      <div className="flex items-center gap-1 flex-1 min-w-0">
        {project.state === 'unregistered' ? (
          renderSpinnerWithTooltip()
        ) : (
          <SidebarItemMiniButton
            type="button"
            className="relative"
            onClick={(e) => {
              e.stopPropagation();
              sidebarStore.toggleProjectExpanded(projectId);
            }}
          >
            <FolderClosed className="absolute h-4 w-4 transition-opacity duration-150 opacity-100 group-hover/row:opacity-0" />
            <ChevronRight
              className={cn(
                'absolute h-4 w-4 transition-all duration-150 opacity-0 group-hover/row:opacity-100',
                isExpanded && 'rotate-90'
              )}
            />
          </SidebarItemMiniButton>
        )}
        <span
          className={cn(
            'flex-1 min-w-0 self-stretch flex items-center truncate text-left transition-colors',
            projectViewKind(getProjectStore(projectId)) === 'bootstrapping' &&
              'text-foreground-tertiary-passive'
          )}
        >
          {project.name}
        </span>
      </div>
      <SidebarItemMiniButton
        type="button"
        className={'opacity-0 group-hover/row:opacity-100 transition-opacity duration-150'}
        onPointerEnter={() => prefetchRepository()}
        onClick={(e) => {
          e.stopPropagation();
          showCreateTaskModal({ projectId });
        }}
        disabled={project.state === 'unregistered'}
      >
        <Plus className="h-4 w-4" />
      </SidebarItemMiniButton>
    </SidebarMenuRow>
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
