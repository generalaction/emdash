import { formatAutomationError, formatRunName } from '@shared/automations/format';
import type { AutomationRun } from '@shared/automations/types';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { useAutomations } from './useAutomations';

export function useAutomationRunActions() {
  const { removeRun, runNow } = useAutomations();
  const { toast } = useToast();
  const showConfirmDelete = useShowModal('confirmActionModal');

  function deleteRun(run: AutomationRun) {
    showConfirmDelete({
      title: 'Delete run',
      description: `Run “${formatRunName(run.id)}” will be permanently removed from the history.`,
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
      description: 'The selected runs will be permanently removed from history.',
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

  return {
    deleteRun,
    bulkDeleteRuns,
    rerunFrom,
    runNowPending: runNow.isPending,
    runNowVariables: runNow.variables,
  };
}
