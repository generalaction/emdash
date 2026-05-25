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
  { value: 'last-24-hours', label: 'Last 24 hours' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this-week', label: 'This week' },
  { value: 'last-7-days', label: 'Last 7 days' },
  { value: 'last-30-days', label: 'Last 30 days' },
];
