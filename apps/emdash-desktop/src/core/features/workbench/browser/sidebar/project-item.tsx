import { ContextMenu, Tooltip } from '@emdash/ui/react/primitives';
import {
  CableIcon,
  ChevronRight,
  FolderClosed,
  FolderInput,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import React, { useCallback, useEffect } from 'react';
import { ConnectionStatusDot } from '@core/features/machines/contributions/browser/connection-status-dot';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import {
  isUnmountedProject,
  isUnregisteredProject,
  type ProjectCreationStage,
} from '@core/features/projects/api/browser/stores/project';
import {
  getProjectStore,
  projectViewKind,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { useConfirmDeleteProject } from '@core/features/projects/contributions/browser/use-confirm-delete-project';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { getGitRepositoryStore } from '@core/features/source-control/api/browser/stores/source-control-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
import {
  useNavigate,
  useViewParams,
  useWorkspaceSlots,
} from '@core/primitives/navigation/browser/navigation-hooks';
import type { ConnectionState } from '@core/primitives/ssh/api';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  SidebarItemMiniButton,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuRow,
} from './sidebar-primitives';

const UNREGISTERED_STAGE_LABEL: Record<ProjectCreationStage, string> = {
  'creating-repo': 'Creating repository…',
  cloning: 'Cloning…',
  registering: 'Registering…',
};

export const SidebarProjectItem = observer(function SidebarProjectItem({
  projectId,
}: {
  projectId: string;
}) {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const projectParams = useViewParams(projectViewDef);
  const taskParams = useViewParams(taskViewDef);
  const openCreateTaskModal = useOpenModal('taskModal');
  const openChangeConnectionModal = useOpenModal('changeProjectConnectionModal');
  const confirmDeleteProject = useConfirmDeleteProject();

  const project = getProjectStore(projectId);

  const prefetchRepository = useCallback(() => {
    const repo = getGitRepositoryStore(projectId);
    void repo?.localData.load();
    void repo?.remoteData.load();
  }, [projectId]);

  const currentProjectId =
    currentView === 'task'
      ? taskParams?.projectId
      : currentView === 'project'
        ? projectParams?.projectId
        : null;
  const currentTaskId = currentView === 'task' ? taskParams?.taskId : null;

  const isProjectActive = currentProjectId === projectId && !currentTaskId;

  useEffect(() => {
    if (isProjectActive) prefetchRepository();
  }, [isProjectActive, prefetchRepository]);

  const isExpanded = getSidebarStore().expandedProjectIds.has(projectId);

  if (!project) return null;

  const sshConnectionId = project.data?.type === 'ssh' ? project.data.connectionId : null;
  const isSshProject = sshConnectionId !== null;
  const sshConnectionState = sshConnectionId ? getMachinesStore().stateFor(sshConnectionId) : null;
  const displayedSshConnectionState: ConnectionState | null =
    isUnmountedProject(project) &&
    project.unmounted.kind === 'failed' &&
    project.unmounted.code === 'ssh-disconnected' &&
    sshConnectionState !== 'connected'
      ? 'disconnected'
      : sshConnectionState;
  const canReconnect = sshConnectionState !== 'connected';
  const ProjectIcon = isSshProject ? FolderInput : FolderClosed;
  const projectLabel = project.name ?? 'project';
  const openProject = () => navigate(projectViewDef({ projectId }));

  const renderSpinnerWithTooltip = () => {
    if (!isUnregisteredProject(project)) return null;
    const label =
      project.creation.kind === 'failed'
        ? 'Failed'
        : UNREGISTERED_STAGE_LABEL[project.creation.stage];
    return (
      <Tooltip.Root>
        <Tooltip.Trigger>
          <SidebarItemMiniButton type="button" disabled aria-label="Loading">
            <Loader2 className="h-4 w-4 animate-spin text-foreground/60" />
          </SidebarItemMiniButton>
        </Tooltip.Trigger>
        <Tooltip.Content>{label}</Tooltip.Content>
      </Tooltip.Root>
    );
  };

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <SidebarMenuRow
          className={cn('group/row h-8 justify-between flex px-1')}
          data-active={isProjectActive || undefined}
          isActive={isProjectActive}
          onMouseDown={(e) => e.preventDefault()}
          onClick={openProject}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {project.state === 'unregistered' ? (
              renderSpinnerWithTooltip()
            ) : (
              <SidebarItemMiniButton
                type="button"
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${projectLabel}`}
                className="relative"
                onClick={(e) => {
                  e.stopPropagation();
                  getSidebarStore().toggleProjectExpanded(projectId);
                }}
              >
                <ProjectIcon className="absolute h-4 w-4 opacity-100 transition-opacity duration-150 group-hover/row:opacity-0" />
                <ChevronRight
                  className={cn(
                    'absolute h-4 w-4 transition-all duration-150 opacity-0 group-hover/row:opacity-100',
                    isExpanded && 'rotate-90'
                  )}
                />
              </SidebarItemMiniButton>
            )}
            <SidebarMenuAction
              aria-label={`Open project ${projectLabel}`}
              className={cn(
                'truncate transition-colors select-none',
                projectViewKind(getProjectStore(projectId)) === 'bootstrapping' &&
                  'text-foreground-tertiary-passive'
              )}
            >
              {isSshProject ? (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{project.name}</span>
                  <ConnectionStatusDot state={displayedSshConnectionState} />
                </span>
              ) : (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{project.name}</span>
                  {projectViewKind(project) === 'path_not_found' && (
                    <Tooltip.Root>
                      <Tooltip.Trigger>
                        <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-foreground-destructive" />
                      </Tooltip.Trigger>
                      <Tooltip.Content>Project not found at path</Tooltip.Content>
                    </Tooltip.Root>
                  )}
                </span>
              )}
            </SidebarMenuAction>
          </div>
          <Tooltip.Root>
            <Tooltip.Trigger
              className="h-6"
              render={
                <SidebarItemMiniButton
                  type="button"
                  aria-label={`New task for ${projectLabel}`}
                  className={
                    'opacity-0 transition-opacity duration-150 group-hover/row:opacity-100'
                  }
                  onPointerEnter={() => prefetchRepository()}
                  onClick={(e) => {
                    e.stopPropagation();
                    void openCreateTaskModal({ projectId });
                  }}
                  disabled={project.state === 'unregistered'}
                >
                  <Plus className="h-4 w-4" />
                </SidebarItemMiniButton>
              }
            />
            <Tooltip.Content>
              New Task
              <BoundShortcut command="app.newTask" variant="keycaps" />
            </Tooltip.Content>
          </Tooltip.Root>
        </SidebarMenuRow>
      </ContextMenu.Trigger>
      <ContextMenu.Content>
        {sshConnectionId && (
          <>
            <ContextMenu.Item
              disabled={!canReconnect}
              onClick={() => {
                void getMachinesStore()
                  .connect(sshConnectionId)
                  .catch(() => {});
              }}
            >
              <RotateCcw className="size-4" />
              Reconnect
            </ContextMenu.Item>
            <ContextMenu.Item
              onClick={() => {
                void openChangeConnectionModal({
                  projectId,
                  currentConnectionId: sshConnectionId,
                });
              }}
            >
              <CableIcon className="size-4" />
              Change SSH Connection
            </ContextMenu.Item>
            <ContextMenu.Separator />
          </>
        )}
        <ContextMenu.Item
          variant="destructive"
          onClick={() => {
            void confirmDeleteProject({
              projectId,
              projectLabel: project.name ?? 'this project',
            });
          }}
        >
          <Trash2 className="size-4" />
          Remove Project
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Root>
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
