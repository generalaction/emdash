import { useMemo } from 'react';
import { formatAutomationError, formatRunName } from '@shared/automations/format';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { useToast } from '@renderer/lib/hooks/use-toast';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Spinner } from '@renderer/lib/ui/spinner';
import { useAutomations, useRecentAutomationRuns } from '../useAutomations';
import { AutomationRunRow } from './AutomationRunRow';

const PAGE_LIMIT = 50;

export function RecentRunsList() {
  const runs = useRecentAutomationRuns(undefined, PAGE_LIMIT);
  const { automations, removeRun, runNow } = useAutomations();
  const { toast } = useToast();
  const showConfirmDelete = useShowModal('confirmActionModal');

  function handleDeleteRun(run: AutomationRun) {
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

  function handleRerun(run: AutomationRun) {
    runNow.mutate(run.automationId, {
      onError: (error) =>
        toast({
          title: 'Automation failed',
          description: formatAutomationError(error),
          variant: 'destructive',
        }),
    });
  }

  const automationById = useMemo(() => {
    const map = new Map<string, Automation>();
    for (const automation of automations.data ?? []) {
      map.set(automation.id, automation);
    }
    return map;
  }, [automations.data]);

  if (runs.isPending) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const items = runs.data ?? [];

  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">No automation runs yet.</p>
      </div>
    );
  }

  return (
    <div>
      {items.map((run) => {
        const automation = automationById.get(run.automationId);
        const canRerun = Boolean(automation && !automation.isDraft);
        return (
          <AutomationRunRow
            key={run.id}
            run={run}
            automation={automation}
            projectId={run.projectId}
            title={run.automationName}
            showProjectName
            paddingClass="px-1"
            onDelete={handleDeleteRun}
            onRerun={canRerun ? handleRerun : undefined}
          />
        );
      })}
    </div>
  );
}
