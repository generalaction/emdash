import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { formatAutomationError } from '@shared/automations/format';
import { slugFromRunId } from '@shared/automations/run-slug';
import type { AutomationRun } from '@shared/automations/types';
import { useAutomations } from './useAutomations';

export function useAutomationRunActions() {
  const { removeRun, runNow, forceCancelRun } = useAutomations();
  const { toast } = useToast();
  const showConfirmDelete = useShowModal('confirmActionModal');

  function deleteRun(run: AutomationRun) {
    showConfirmDelete({
      title: 'Delete run',
      description: `Run “${slugFromRunId(run.id)}” will be permanently removed from history. Any task or worktree created by this run will be kept.`,
      confirmLabel: 'Delete',
      onSuccess: () =>
        removeRun.mutate(run.id, {
          onError: (error) =>
            toast({
              title: 'Failed to delete run',
              description: error instanceof Error ? error.message : String(error),
              variant: 'destructive',
            }),
        }),
    });
  }

  function bulkDeleteRuns(runIds: ReadonlyArray<string>, onDone?: () => void) {
    if (runIds.length === 0) return;
    showConfirmDelete({
      title: `Delete ${runIds.length} run${runIds.length === 1 ? '' : 's'}`,
      description:
        'The selected runs will be permanently removed from history. Any tasks or worktrees created by these runs will be kept.',
      confirmLabel: `Delete ${runIds.length} run${runIds.length === 1 ? '' : 's'}`,
      onSuccess: () => {
        for (const id of runIds) {
          removeRun.mutate(id, {
            onError: (error) =>
              toast({
                title: 'Failed to delete run',
                description: error instanceof Error ? error.message : String(error),
                variant: 'destructive',
              }),
          });
        }
        onDone?.();
      },
    });
  }

  function rerunFrom(automationId: string) {
    runNow.mutate(automationId, {
      onError: (error) =>
        toast({
          title: 'Automation failed',
          description: formatAutomationError(error),
          variant: 'destructive',
        }),
    });
  }

  function forceCancel(run: AutomationRun) {
    forceCancelRun.mutate(run.id, {
      onError: (error) =>
        toast({
          title: 'Failed to cancel run',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        }),
    });
  }

  return {
    deleteRun,
    bulkDeleteRuns,
    rerunFrom,
    forceCancel,
  };
}
