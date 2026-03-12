import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import {
  usePendingProjectsContext,
  type PendingProject,
  type PendingProjectStage,
} from '@renderer/components/add-project-modal/pending-projects-provider';
import ProjectMainView from '@renderer/components/ProjectMainView';
import OpenInMenu from '@renderer/components/titlebar/OpenInMenu';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { Button } from '@renderer/components/ui/button';
import {
  useCurrentProject,
  useCurrentProjectStatus,
} from '@renderer/contexts/CurrentProjectProvider';
import { useProjectManagementContext } from '@renderer/contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '@renderer/contexts/TaskManagementProvider';
import { useWorkspaceNavigation } from '@renderer/contexts/WorkspaceNavigationContext';
import { useWorkspaceWrapParams } from '@renderer/contexts/WorkspaceViewProvider';
import { useProjectBranchOptions } from '@renderer/hooks/useProjectBranchOptions';

const STAGE_LABELS: Record<PendingProjectStage, string> = {
  'creating-repo': 'Creating repository',
  cloning: 'Cloning',
  initializing: 'Initializing',
  registering: 'Registering',
  error: 'Error',
};

const STAGES_BY_MODE: Record<PendingProject['mode'], PendingProjectStage[]> = {
  pick: ['registering'],
  clone: ['cloning', 'registering'],
  new: ['creating-repo', 'cloning', 'registering'],
};

function PendingProjectStatus({ pending }: { pending: PendingProject }) {
  const { removePending } = usePendingProjectsContext();
  const { navigate } = useWorkspaceNavigation();
  const stages = STAGES_BY_MODE[pending.mode];
  const currentStageIndex = stages.indexOf(pending.stage as PendingProjectStage);
  const isError = pending.stage === 'error';

  const handleDismiss = () => {
    removePending(pending.id);
    navigate('home');
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-3">
        <h2 className="mb-2 text-base font-semibold">{pending.name}</h2>

        {stages.map((stage, i) => {
          const isDone = !isError && i < currentStageIndex;
          const isActive = !isError && stage === pending.stage;
          return (
            <div key={stage} className="flex items-center gap-3">
              <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                {isDone ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : isActive ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                )}
              </div>
              <span
                className={
                  isActive
                    ? 'text-sm font-medium text-foreground'
                    : isDone
                      ? 'text-sm text-muted-foreground'
                      : 'text-sm text-muted-foreground/50'
                }
              >
                {STAGE_LABELS[stage]}
              </span>
            </div>
          );
        })}

        {isError && (
          <div className="mt-2 flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span className="text-sm text-destructive">
                {pending.error ?? 'An error occurred'}
              </span>
            </div>
            <Button size="sm" variant="outline" className="self-start" onClick={handleDismiss}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Dismiss
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProjectTitlebar() {
  const project = useCurrentProject();
  const status = useCurrentProjectStatus();
  const { wrapParams } = useWorkspaceWrapParams();
  const { pendingProjects } = usePendingProjectsContext();

  const pendingName =
    status === 'creating'
      ? (pendingProjects.find((p) => p.id === wrapParams.projectId)?.name ?? null)
      : null;

  const displayName = project?.name ?? pendingName;
  const currentPath = project?.isRemote ? project?.remotePath : project?.path || null;

  return (
    <Titlebar
      leftSlot={
        displayName && (
          <div className="flex items-center px-2">
            <span className="text-[13px] font-medium text-muted-foreground">{displayName}</span>
          </div>
        )
      }
      rightSlot={
        currentPath && (
          <OpenInMenu
            path={currentPath}
            align="right"
            isRemote={project?.isRemote || false}
            sshConnectionId={project?.sshConnectionId || null}
          />
        )
      }
    />
  );
}

export function ProjectMainPanel() {
  const project = useCurrentProject();
  const status = useCurrentProjectStatus();
  const { wrapParams } = useWorkspaceWrapParams();
  const { pendingProjects } = usePendingProjectsContext();
  const { deleteProject } = useProjectManagementContext();
  const {
    tasksByProjectId,
    openTaskModal,
    handleSelectTask,
    handleDeleteTask,
    handleArchiveTask,
    handleRestoreTask,
  } = useTaskManagementContext();
  const { projectBranchOptions, isLoadingBranches, setProjectDefaultBranch } =
    useProjectBranchOptions(project);

  if (status === 'creating') {
    const pending = pendingProjects.find((p) => p.id === wrapParams.projectId);
    if (pending) {
      return <PendingProjectStatus pending={pending} />;
    }
  }

  if (!project) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground" />;
  }

  const tasks = tasksByProjectId[project.id] ?? [];
  const projectWithTasks = { ...project, tasks };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      Main view
      {/* <ProjectMainView
        project={projectWithTasks}
        onCreateTask={() => openTaskModal()}
        activeTask={null}
        onSelectTask={handleSelectTask}
        onDeleteTask={handleDeleteTask}
        onArchiveTask={handleArchiveTask}
        onRestoreTask={handleRestoreTask}
        onDeleteProject={() => deleteProject(project.id)}
        branchOptions={projectBranchOptions}
        isLoadingBranches={isLoadingBranches}
        onBaseBranchChange={setProjectDefaultBranch}
      /> */}
    </div>
  );
}
