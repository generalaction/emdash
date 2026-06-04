import { useMemo } from 'react';
import { Spinner } from '@renderer/lib/ui/spinner';
import type { Automation, AutomationRunWithContext } from '@shared/automations/types';
import { useAutomationRunActions } from '../use-automation-run-actions';
import { AutomationRunRow } from './AutomationRunRow';

interface RecentRunsListProps {
  runs: AutomationRunWithContext[] | undefined;
  isPending: boolean;
  automations: Automation[];
  filtersActive?: boolean;
  isSelected?: (id: string) => boolean;
  onToggleSelect?: (id: string) => void;
}

export function RecentRunsList({
  runs,
  isPending,
  automations,
  filtersActive = false,
  isSelected,
  onToggleSelect,
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
        <p className="text-muted-foreground text-sm">
          {filtersActive ? 'No runs match your filters.' : 'No automation runs yet.'}
        </p>
      </div>
    );
  }

  return (
    <>
      {runs.map((run) => {
        const automation = automationById.get(run.automationId);
        const canRerun = Boolean(automation && !automation.isDraft && automation.projectId);
        return (
          <AutomationRunRow
            key={run.id}
            run={run}
            automation={automation}
            projectId={run.projectId}
            title={run.automationName}
            showProjectName
            variant="card"
            onDelete={deleteRun}
            onRerun={canRerun ? () => rerunFrom(run.automationId) : undefined}
            isSelected={isSelected?.(run.id) ?? false}
            onToggleSelect={onToggleSelect ? () => onToggleSelect(run.id) : undefined}
          />
        );
      })}
    </>
  );
}
