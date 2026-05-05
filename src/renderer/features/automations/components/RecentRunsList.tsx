import { useMemo } from 'react';
import type { Automation } from '@shared/automations/types';
import { Spinner } from '@renderer/lib/ui/spinner';
import { useAutomations, useRecentAutomationRuns } from '../useAutomations';
import { AutomationRunRow } from './AutomationRunRow';

const PAGE_LIMIT = 50;

export function RecentRunsList() {
  const runs = useRecentAutomationRuns(undefined, PAGE_LIMIT);
  const { automations } = useAutomations();

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
    <div className="divide-y divide-border/70 border-y border-border/70">
      {items.map((run) => (
        <AutomationRunRow
          key={run.id}
          run={run}
          automation={automationById.get(run.automationId)}
          projectId={run.projectId}
          title={run.automationName}
          showProjectName
          paddingClass="px-1"
        />
      ))}
    </div>
  );
}
