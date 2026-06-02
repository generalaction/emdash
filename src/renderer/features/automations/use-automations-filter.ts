import { useMemo } from 'react';
import {
  type AutomationRunsFacetFilters,
  hasAutomationRunsFacetFilters,
} from '@renderer/features/automations/automation-runs-filter-types';
import { statusIndicatorConfig } from '@renderer/features/automations/run-status-styles';
import { isWithinTimeRange } from '@renderer/features/automations/time-range-utils';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import type { ListFilterOption } from '@renderer/lib/components/list-filters/types';
import { formatRunTriggerKindLabel, isQueueDeadlineExceededRun } from '@shared/automations/format';
import { slugFromRunId } from '@shared/automations/run-slug';
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
      if (isQueueDeadlineExceededRun(run)) continue;
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
    if (!query && !hasRunFacetFilters) {
      matched = matched.filter((run) => !isQueueDeadlineExceededRun(run));
    }
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

function runMatchesQuery(run: AutomationRunWithContext, query: string): boolean {
  if (slugFromRunId(run.id).toLowerCase().includes(query)) return true;
  if (run.automationName.toLowerCase().includes(query)) return true;
  const projectName = run.projectId ? projectDisplayName(getProjectStore(run.projectId)) : null;
  if (projectName && projectName.toLowerCase().includes(query)) return true;
  if (statusIndicatorConfig(run.status).label.toLowerCase().includes(query)) return true;
  if (formatRunTriggerKindLabel(run.triggerKind).toLowerCase().includes(query)) return true;
  return false;
}
