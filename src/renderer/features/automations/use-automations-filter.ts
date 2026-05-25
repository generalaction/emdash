import { endOfDay, startOfDay, startOfWeek, subDays } from 'date-fns';
import { useMemo } from 'react';
import {
  type AutomationRunsFacetFilters,
  type AutomationRunsTimeRange,
  hasAutomationRunsFacetFilters,
} from '@renderer/features/automations/automation-runs-filter-types';
import { statusIndicatorConfig } from '@renderer/features/automations/run-status-styles';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import type { ListFilterOption } from '@renderer/lib/components/list-filters/types';
import { formatRunName, formatRunTriggerKindLabel } from '@shared/automations/format';
import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunWithContext,
} from '@shared/automations/types';

export interface AutomationRunFilterOption {
  value: string;
  label: string;
}

export interface AutomationRunsFilterOptions {
  automations: AutomationRunFilterOption[];
  statuses: ListFilterOption<AutomationRunStatus>[];
}

export interface AutomationsFilterResult {
  query: string;
  drafts: Automation[];
  active: Automation[];
  paused: Automation[];
  hasResults: boolean;
  visibleRuns: AutomationRunWithContext[] | undefined;
  runsByAutomation: Map<string, AutomationRun[]>;
  runsFilterOptions: AutomationRunsFilterOptions;
  hasRunFacetFilters: boolean;
}

interface UseAutomationsFilterOptions {
  automations: readonly Automation[];
  runs: AutomationRunWithContext[] | undefined;
  search: string;
  runsVisibleLimit: number;
  runFacetFilters?: AutomationRunsFacetFilters;
}

export function useAutomationsFilter({
  automations,
  runs,
  search,
  runsVisibleLimit,
  runFacetFilters,
}: UseAutomationsFilterOptions): AutomationsFilterResult {
  const query = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!query) return automations.slice();
    return automations.filter((automation) => automation.name.toLowerCase().includes(query));
  }, [automations, query]);

  const drafts = useMemo(() => filtered.filter((a) => a.isDraft), [filtered]);
  const active = useMemo(() => filtered.filter((a) => !a.isDraft && a.enabled), [filtered]);
  const paused = useMemo(() => filtered.filter((a) => !a.isDraft && !a.enabled), [filtered]);

  const runsByAutomation = useMemo(() => {
    const map = new Map<string, AutomationRun[]>();
    for (const run of runs ?? []) {
      const list = map.get(run.automationId);
      if (list) list.push(run);
      else map.set(run.automationId, [run]);
    }
    return map;
  }, [runs]);

  const facetFilters = runFacetFilters;
  const hasRunFacetFilters = hasAutomationRunsFacetFilters(
    facetFilters ?? { statuses: [], automationId: null, timeRange: null }
  );

  const runsFilterOptions = useMemo(() => buildRunsFilterOptions(runs), [runs]);

  const visibleRuns = useMemo(() => {
    if (!runs) return undefined;
    let matched = runs;
    if (facetFilters && hasRunFacetFilters) {
      matched = matched.filter((run) => runMatchesFacetFilters(run, facetFilters));
    }
    if (query) matched = matched.filter((run) => runMatchesQuery(run, query));
    return matched.slice(0, runsVisibleLimit);
  }, [runs, query, runsVisibleLimit, facetFilters, hasRunFacetFilters]);

  return {
    query,
    drafts,
    active,
    paused,
    hasResults: filtered.length > 0,
    visibleRuns,
    runsByAutomation,
    runsFilterOptions,
    hasRunFacetFilters,
  };
}

const ALL_RUN_STATUSES: AutomationRunStatus[] = [
  'running',
  'queued',
  'success',
  'failed',
  'skipped',
];

function buildRunsFilterOptions(
  runs: AutomationRunWithContext[] | undefined
): AutomationRunsFilterOptions {
  const automationLabels = new Map<string, string>();

  for (const run of runs ?? []) {
    automationLabels.set(run.automationId, run.automationName);
  }

  const automations = [...automationLabels.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const statuses: ListFilterOption<AutomationRunStatus>[] = ALL_RUN_STATUSES.map((status) => ({
    value: status,
    label: statusIndicatorConfig(status).label,
  }));

  return { automations, statuses };
}

function runMatchesFacetFilters(
  run: AutomationRunWithContext,
  filters: AutomationRunsFacetFilters
): boolean {
  if (filters.statuses.length > 0 && !filters.statuses.includes(run.status)) return false;
  if (filters.automationId !== null && run.automationId !== filters.automationId) return false;
  if (filters.timeRange !== null) {
    const timestamp = runTimestamp(run);
    if (timestamp == null || !isWithinTimeRange(timestamp, filters.timeRange)) return false;
  }
  return true;
}

function runTimestamp(run: AutomationRunWithContext): number | null {
  return run.startedAt ?? run.scheduledAt ?? run.finishedAt;
}

function isWithinTimeRange(timestamp: number, range: AutomationRunsTimeRange): boolean {
  const now = Date.now();
  const { start, end } = timeRangeBounds(range, now);
  return timestamp >= start && timestamp <= end;
}

function timeRangeBounds(
  range: AutomationRunsTimeRange,
  now: number
): { start: number; end: number } {
  const date = new Date(now);
  switch (range) {
    case 'last-24-hours':
      return { start: now - 24 * 60 * 60 * 1000, end: now };
    case 'today':
      return { start: startOfDay(date).getTime(), end: endOfDay(date).getTime() };
    case 'yesterday': {
      const yesterday = subDays(date, 1);
      return { start: startOfDay(yesterday).getTime(), end: endOfDay(yesterday).getTime() };
    }
    case 'this-week':
      return { start: startOfWeek(date, { weekStartsOn: 1 }).getTime(), end: now };
    case 'last-7-days':
      return { start: startOfDay(subDays(date, 6)).getTime(), end: now };
    case 'last-30-days':
      return { start: startOfDay(subDays(date, 29)).getTime(), end: now };
  }
}

function runMatchesQuery(run: AutomationRunWithContext, query: string): boolean {
  if (formatRunName(run.id).toLowerCase().includes(query)) return true;
  if (run.automationName.toLowerCase().includes(query)) return true;
  const projectName = run.projectId ? projectDisplayName(getProjectStore(run.projectId)) : null;
  if (projectName && projectName.toLowerCase().includes(query)) return true;
  if (statusIndicatorConfig(run.status).label.toLowerCase().includes(query)) return true;
  if (formatRunTriggerKindLabel(run.triggerKind).toLowerCase().includes(query)) return true;
  return false;
}
