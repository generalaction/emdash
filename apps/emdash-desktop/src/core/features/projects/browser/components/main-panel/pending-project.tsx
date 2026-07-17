import type { WorkspaceError } from '@emdash/core/runtimes/workspace/api';
import {
  SteppedLoader,
  type SteppedLoaderProps,
  type SteppedLoaderStep,
} from '@emdash/ui/react/components';
import { observer } from 'mobx-react-lite';
import { type UnregisteredProject } from '@core/features/projects/browser/stores/project';
import { getProjectManagerStore } from '@core/features/projects/browser/stores/project-selectors';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import type { WorkspaceBootstrapProgress } from '@core/features/workspaces/api';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { bootstrapProgressToSteppedLoader } from '@renderer/lib/provisioning/bootstrap-stepped-loader';
import { Button } from '@renderer/lib/ui/button';

type Stage = 'creating-repo' | 'cloning' | 'registering';

const STAGE_LABELS: Record<Stage, string> = {
  'creating-repo': 'Creating repository',
  cloning: 'Cloning repository',
  registering: 'Registering project',
};

const STAGES_BY_MODE: Record<'pick' | 'clone' | 'new', Stage[]> = {
  pick: ['registering'],
  clone: ['cloning', 'registering'],
  new: ['creating-repo', 'cloning', 'registering'],
};

export const PendingProjectStatus = observer(function PendingProjectStatus({
  project,
}: {
  project: UnregisteredProject;
}) {
  const { navigate } = useNavigate();
  const isError = project.phase === 'error';
  const manager = getProjectManagerStore();
  const loader = projectToSteppedLoader(project);

  const handleDismiss = () => {
    manager.removeUnregisteredProject(project.id);
    navigate(homeViewDef());
  };

  const handleCancel = () => {
    manager.cancelProjectCreation(project.id);
  };

  const actions = isError ? (
    <Button size="sm" variant="ghost" onClick={handleDismiss}>
      Dismiss
    </Button>
  ) : project.phase === 'cloning' ? (
    <Button size="sm" variant="ghost" onClick={handleCancel}>
      Cancel
    </Button>
  ) : undefined;

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="flex h-64 w-full max-w-md min-w-0">
        <SteppedLoader
          className="flex-1"
          steps={loader.steps}
          activeStepId={loader.activeStepId}
          status={loader.status}
          actions={actions}
        />
      </div>
      {isError && (
        <p className="text-destructive max-w-full text-sm wrap-break-word">
          {project.error ?? 'Project creation failed'}
        </p>
      )}
    </div>
  );
});

function projectToSteppedLoader(
  project: UnregisteredProject
): Pick<SteppedLoaderProps, 'steps' | 'activeStepId' | 'status'> {
  const error = project.phase === 'error' ? projectError(project) : null;
  if (project.operation) {
    const progress = projectProgress(project);
    const model = bootstrapProgressToSteppedLoader(progress, error);
    const steps = projectSteps(project, model.steps);
    const activeStepId = project.phase === 'registering' ? 'registering' : model.activeStepId;
    return {
      steps,
      activeStepId,
      status: error ? 'error' : project.phase === 'registering' ? 'loading' : model.status,
    };
  }

  const stages = STAGES_BY_MODE[project.mode];
  const activeStage = project.phase === 'error' ? stages.at(-1) : (project.phase as Stage);
  const activeStepId = activeStage ?? stages[0];
  return {
    steps: stages.map((stage) => ({ id: stage, name: STAGE_LABELS[stage] })),
    activeStepId,
    status: error ? 'error' : 'loading',
  };
}

function projectProgress(project: UnregisteredProject): WorkspaceBootstrapProgress {
  return {
    step: project.phase === 'registering' ? 'initialising-workspace' : 'setting-up-workspace',
    message: project.progressMessage ?? STAGE_LABELS.cloning,
    operation: project.operation,
  };
}

function projectSteps(
  project: UnregisteredProject,
  runtimeSteps: SteppedLoaderStep[]
): SteppedLoaderStep[] {
  const steps =
    project.mode === 'new'
      ? [{ id: 'creating-repo', name: STAGE_LABELS['creating-repo'] }, ...runtimeSteps]
      : runtimeSteps;

  if (steps.some((step) => step.id === 'registering')) {
    return steps;
  }

  return [...steps, { id: 'registering', name: STAGE_LABELS.registering }];
}

function projectError(project: UnregisteredProject): WorkspaceError {
  return {
    type: 'project-creation-failed',
    message: project.error ?? 'Project creation failed',
  };
}
