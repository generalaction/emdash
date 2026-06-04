import { useMemo } from 'react';
import type {
  AutomationRunsFacetFilters,
  AutomationRunsTimeRange,
} from '@renderer/features/automations/automation-runs-filter-types';
import { hasAutomationRunsFacetFilters } from '@renderer/features/automations/automation-runs-filter-types';
import type { Automation } from '@shared/automations/automation';
import type {
  AutomationRunStatus,
  AutomationRunWithContext,
} from '@shared/automations/automation-run';

export interface AutomationRunsFilterOptions {
  automations: ReadonlyArray<{ value: string; label: string }>;
  statuses: ReadonlyArray<{ value: AutomationRunStatus; label: string }>;
}

interface UseAutomationsFilterInput {
  automations: Automation[];
  runs?: AutomationRunWithContext[];
  search?: string;
  runsVisibleLimit?: number;
  runFacetFilters?: AutomationRunsFacetFilters;
}

export interface AutomationsFilterResult {
  all: Automation[];
  active: Automation[];
  paused: Automation[];
  filteredRuns: AutomationRunWithContext[];
  filterOptions: AutomationRunsFilterOptions;
  hasResults: boolean;
}

const RUN_STATUS_LABELS: Record<AutomationRunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
  skipped: 'Skipped',
};

function matchesTimeRange(
  run: AutomationRunWithContext,
  timeRange: AutomationRunsTimeRange
): boolean {
  const ts = run.startedAt ?? run.scheduledAt ?? run.finishedAt;
  if (ts == null) return false;
  const now = Date.now();
  const date = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  switch (timeRange) {
    case 'last-24-hours':
      return now - ts <= 24 * 60 * 60 * 1000;
    case 'today':
      return date >= today;
    case 'yesterday': {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return date >= yesterday && date < today;
    }
    case 'this-week': {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay());
      return date >= weekStart;
    }
    case 'last-7-days':
      return now - ts <= 7 * 24 * 60 * 60 * 1000;
    case 'last-30-days':
      return now - ts <= 30 * 24 * 60 * 60 * 1000;
    default:
      return true;
  }
}

export function useAutomationsFilter({
  automations,
  runs = [],
  search = '',
  runsVisibleLimit,
  runFacetFilters,
}: UseAutomationsFilterInput): AutomationsFilterResult {
  return useMemo(() => {
    const searchLower = search.trim().toLowerCase();

    const active = automations.filter(
      (a) => a.enabled && (!searchLower || a.name.toLowerCase().includes(searchLower))
    );
    const paused = automations.filter(
      (a) => !a.enabled && (!searchLower || a.name.toLowerCase().includes(searchLower))
    );

    let filteredRuns = runs;

    if (runFacetFilters && hasAutomationRunsFacetFilters(runFacetFilters)) {
      filteredRuns = filteredRuns.filter((run) => {
        if (runFacetFilters.statuses.length > 0 && !runFacetFilters.statuses.includes(run.status)) {
          return false;
        }
        if (
          runFacetFilters.automationId != null &&
          run.automationId !== runFacetFilters.automationId
        ) {
          return false;
        }
        if (
          runFacetFilters.timeRange != null &&
          !matchesTimeRange(run, runFacetFilters.timeRange)
        ) {
          return false;
        }
        return true;
      });
    }

    if (searchLower) {
      filteredRuns = filteredRuns.filter(
        (run) =>
          run.automationName.toLowerCase().includes(searchLower) ||
          run.id.toLowerCase().includes(searchLower)
      );
    }

    if (runsVisibleLimit != null) {
      filteredRuns = filteredRuns.slice(0, runsVisibleLimit);
    }

    const statusesInRuns = [...new Set(runs.map((r) => r.status))];
    const filterOptions: AutomationRunsFilterOptions = {
      automations: automations.map((a) => ({ value: a.id, label: a.name })),
      statuses: statusesInRuns.map((status) => ({
        value: status,
        label: RUN_STATUS_LABELS[status] ?? status,
      })),
    };

    const hasResults = searchLower
      ? active.length > 0 || paused.length > 0
      : automations.length > 0;

    return {
      all: automations,
      active,
      paused,
      filteredRuns,
      filterOptions,
      hasResults,
    };
  }, [automations, runs, search, runsVisibleLimit, runFacetFilters]);
}
