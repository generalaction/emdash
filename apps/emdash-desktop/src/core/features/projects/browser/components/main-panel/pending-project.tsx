import {
  SteppedLoader,
  SteppedLoaderProgress,
  type SteppedLoaderProps,
} from '@emdash/ui/react/components';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { type UnregisteredProject } from '@core/features/projects/api/browser/stores/project';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import { Button } from '@core/primitives/ui/browser/button';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';

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
  const stages = STAGES_BY_MODE[project.mode];
  const activeStage = project.phase === 'error' ? stages.at(-1) : (project.phase as Stage);
  const activeStepId = activeStage ?? stages[0];
  const activeChildren = progressChildren(project);
  return {
    steps: stages.map((stage) => ({
      id: stage,
      name: STAGE_LABELS[stage],
      children: stage === activeStepId ? activeChildren : undefined,
    })),
    activeStepId,
    status: project.phase === 'error' ? 'error' : 'loading',
  };
}

function progressChildren(project: UnregisteredProject): ReactNode {
  if (project.phase === 'error' || project.progressPercent === undefined) {
    return undefined;
  }

  const percent = Math.max(0, Math.min(100, Math.round(project.progressPercent)));
  const label = STAGE_LABELS[(project.phase as Stage) ?? 'cloning'] ?? STAGE_LABELS.cloning;
  return (
    <SteppedLoaderProgress
      percent={percent}
      leftLabel={project.progressMessage ?? label}
      rightLabel={`${percent}%`}
      aria-label={label}
    />
  );
}
