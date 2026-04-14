import { ChevronRight, FolderClosed, Loader2, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect } from 'react';
import {
  isUnregisteredProject,
  UnregisteredProject,
} from '@renderer/features/projects/stores/project';
import {
  getProjectStore,
  getRepositoryStore,
  projectViewKind,
} from '@renderer/features/projects/stores/project-selectors';
import {
  useNavigate,
  useParams,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { sidebarStore } from '@renderer/lib/stores/app-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
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

  const prefetchRepository = useCallback(() => {
    const repo = getRepositoryStore(projectId);
    void repo?.localData.load();
    void repo?.remoteData.load();
  }, [projectId]);

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
            'flex-1 min-w-0 self-stretch flex items-center truncate text-left transition-colors select-none',
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
