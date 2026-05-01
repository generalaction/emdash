import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { type UnregisteredProject } from '@renderer/features/projects/stores/project';
import { getProjectManagerStore } from '@renderer/features/projects/stores/project-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';

type Stage = 'creating-repo' | 'cloning' | 'registering';

const STAGE_LABELS: Record<Stage, string> = {
  'creating-repo': 'Creating repository',
  cloning: 'Cloning',
  registering: 'Registering',
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
  const stages = STAGES_BY_MODE[project.mode];
  const currentStageIndex = stages.indexOf(project.phase as Stage);
  const isError = project.phase === 'error';

  const handleDismiss = () => {
    getProjectManagerStore().removeUnregisteredProject(project.id);
    navigate('home');
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm min-w-0 flex-col gap-3">
        <h2 className="mb-2 text-base">{project.name}</h2>

        {stages.map((stage, i) => {
          const isDone = !isError && i < currentStageIndex;
          const isActive = !isError && stage === project.phase;
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
          <div className="mt-2 flex min-w-0 flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <div className="flex min-w-0 items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span className="min-w-0 break-words text-sm text-destructive">
                {project.error ?? 'An error occurred'}
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
});
