import { Plus, Repeat2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { MicroLabel } from '@renderer/lib/ui/label';
import { cn } from '@renderer/utils/utils';
import { loopPhaseProgress, loopStatusMeta, statusDotClass } from './loop-format';
import { loopsStore } from './loops-store';

export const SidebarLoopsSection = observer(function SidebarLoopsSection() {
  const { projectId, taskId } = useTaskViewContext();
  const { value: experiments } = useAppSettingsKey('experiments');
  const loopsEnabled = experiments?.loops ?? false;
  const { navigate } = useNavigate();
  const showCreateLoopModal = useShowModal('createLoopModal');

  useEffect(() => {
    if (loopsEnabled) loopsStore.ensureProjectLoaded(projectId);
  }, [loopsEnabled, projectId]);

  if (!loopsEnabled) return null;

  const loops = loopsStore.getLoopsForProject(projectId).filter((loop) => loop.taskId === taskId);
  const loadState = loopsStore.getProjectLoadState(projectId);

  const handleCreate = () => {
    showCreateLoopModal({
      projectId,
      taskId,
      onSuccess: ({ loopId }) => {
        navigate('loop', { projectId, taskId, loopId });
      },
    });
  };

  return (
    <section className="shrink-0 border-b border-border px-2 pb-2">
      <div className="flex items-center justify-between pt-2 pr-0 pb-1 pl-2">
        <div className="flex items-center gap-1.5">
          <Repeat2 className="size-3.5 text-foreground-passive" />
          <MicroLabel>Loops</MicroLabel>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={handleCreate} aria-label="Create loop">
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        {loops.map((loop) => {
          const status = loopStatusMeta(loop.status);
          const progress = loopPhaseProgress(loop);
          return (
            <button
              key={loop.id}
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground"
              onClick={() => navigate('loop', { projectId, taskId, loopId: loop.id })}
            >
              <span
                className={cn('size-2 shrink-0 rounded-full', statusDotClass(status.tone))}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{loop.name}</span>
              <span className="shrink-0 font-mono text-xs text-foreground-passive">
                {progress.passed}/{progress.total}
              </span>
            </button>
          );
        })}
        {loops.length === 0 && loadState.kind !== 'loading' ? (
          <div className="px-2 py-1 text-xs text-foreground-passive">No loops yet.</div>
        ) : null}
        {loadState.kind === 'loading' ? (
          <div className="px-2 py-1 text-xs text-foreground-passive">Loading loops...</div>
        ) : null}
        {loadState.kind === 'error' ? (
          <div className="px-2 py-1 text-xs text-foreground-destructive">
            {loadState.error ?? 'Failed to load loops.'}
          </div>
        ) : null}
      </div>
    </section>
  );
});
