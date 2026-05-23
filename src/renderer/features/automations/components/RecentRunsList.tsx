import { RotateCcw, Trash2, X } from 'lucide-react';
import { useMemo } from 'react';
import { useMultiSelect } from '@renderer/lib/hooks/use-multi-select';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import type { Automation, AutomationRunWithContext } from '@shared/automations/types';
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
  const { deleteRun, bulkDeleteRuns, rerunFrom } = useAutomationRunActions();

  const automationById = useMemo(() => {
    const map = new Map<string, Automation>();
    for (const automation of automations) {
      map.set(automation.id, automation);
    }
    return map;
  }, [automations]);

  const visibleRuns = runs ?? [];
  const selection = useMultiSelect<AutomationRunWithContext>({
    items: visibleRuns,
    getId: (run) => run.id,
  });

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
          {searchActive ? 'No runs match your search.' : 'No automation runs yet.'}
        </p>
      </div>
    );
  }

  const selectedRuns = visibleRuns.filter((run) => selection.selectedIds.has(run.id));
  const selectedCount = selectedRuns.length;
  const rerunnableSelectedRuns = selectedRuns.filter((run) => {
    const automation = automationById.get(run.automationId);
    return automation && !automation.isDraft && automation.projectId;
  });

  const bulkDelete = () => {
    bulkDeleteRuns(
      selectedRuns.map((run) => run.id),
      selection.clear
    );
  };

  const bulkRerun = () => {
    const seen = new Set<string>();
    for (const run of rerunnableSelectedRuns) {
      if (seen.has(run.automationId)) continue;
      seen.add(run.automationId);
      rerunFrom(run.automationId);
    }
    selection.clear();
  };

  return (
    <div className="relative">
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
            paddingClass="px-1"
            onDelete={deleteRun}
            onRerun={canRerun ? () => rerunFrom(run.automationId) : undefined}
            isSelected={selection.isSelected(run.id)}
            onToggleSelect={() => selection.toggle(run.id)}
          />
        );
      })}
      {selectedCount > 0 ? (
        <div className="sticky bottom-4 z-10 mt-2 flex justify-center">
          <div className="flex items-center gap-2 rounded-md border border-border bg-background-1 px-3 py-2 text-sm shadow-md">
            <span className="whitespace-nowrap text-foreground-muted">
              {selectedCount} selected
            </span>
            {rerunnableSelectedRuns.length > 0 ? (
              <Button variant="outline" size="sm" onClick={bulkRerun}>
                <RotateCcw className="size-3.5" />
                Rerun
              </Button>
            ) : null}
            <Button variant="destructive" size="sm" onClick={bulkDelete}>
              <Trash2 className="size-3.5" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={selection.clear}
              aria-label="Clear selection"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
