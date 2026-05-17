import { useMemo } from 'react';
import type { Automation, AutomationRunWithContext } from '@shared/automations/types';
import { Spinner } from '@renderer/lib/ui/spinner';
import { useAutomationRunActions } from '../use-automation-run-actions';
import { AutomationRunRow } from './AutomationRunRow';

interface RecentRunsListProps {
  runs: AutomationRunWithContext[] | undefined;
  isPending: boolean;
  automations: Automation[];
  searchActive?: boolean;
}

export function RecentRunsList({
  runs,
  isPending,
  automations,
  searchActive = false,
}: RecentRunsListProps) {
  const { deleteRun, rerunFrom } = useAutomationRunActions();

  const automationById = useMemo(() => {
    const map = new Map<string, Automation>();
    for (const automation of automations) {
      map.set(automation.id, automation);
    }
    return map;
  }, [automations]);

  if (isPending) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!runs || runs.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground">
          {searchActive ? 'No runs match your search.' : 'No automation runs yet.'}
        </p>
      </div>
    );
  }

  return (
    <div>
      {runs.map((run) => {
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
            onDelete={deleteRun}
            onRerun={canRerun ? () => rerunFrom(run.automationId) : undefined}
          />
        );
      })}
    </div>
  );
}
