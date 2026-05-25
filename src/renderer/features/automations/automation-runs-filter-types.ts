import type { AutomationRunStatus } from '@shared/automations/types';

export type AutomationRunsTimeRange =
  | 'last-24-hours'
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-7-days'
  | 'last-30-days';

export interface AutomationRunsFacetFilters {
  statuses: AutomationRunStatus[];
  automationId: string | null;
  timeRange: AutomationRunsTimeRange | null;
}

export const EMPTY_AUTOMATION_RUNS_FACET_FILTERS: AutomationRunsFacetFilters = {
  statuses: [],
  automationId: null,
  timeRange: null,
};

export function hasAutomationRunsFacetFilters(filters: AutomationRunsFacetFilters): boolean {
  return filters.statuses.length > 0 || filters.automationId !== null || filters.timeRange !== null;
}

export const AUTOMATION_RUNS_TIME_RANGE_OPTIONS: ReadonlyArray<{
  value: AutomationRunsTimeRange;
  label: string;
}> = [
  { value: 'last-24-hours', label: 'Letzte 24 Stunden' },
  { value: 'today', label: 'Heute' },
  { value: 'yesterday', label: 'Gestern' },
  { value: 'this-week', label: 'Diese Woche' },
  { value: 'last-7-days', label: 'Letzte 7 Tage' },
  { value: 'last-30-days', label: 'Letzte 30 Tage' },
];
