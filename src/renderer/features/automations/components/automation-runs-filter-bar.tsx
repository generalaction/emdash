import { useMemo } from 'react';
import {
  AUTOMATION_RUNS_TIME_RANGE_OPTIONS,
  type AutomationRunsFacetFilters,
  type AutomationRunsTimeRange,
} from '@renderer/features/automations/automation-runs-filter-types';
import type { AutomationRunsFilterOptions } from '@renderer/features/automations/use-automations-filter';
import { ListFilterMultiSelect } from '@renderer/lib/components/list-filters/list-filter-multi-select';
import { ListFilterRow } from '@renderer/lib/components/list-filters/list-filter-row';
import { ListFilterSearchableSelect } from '@renderer/lib/components/list-filters/list-filter-searchable-select';
import { ListFilterSingleSelect } from '@renderer/lib/components/list-filters/list-filter-single-select';
import type { AutomationRunStatus } from '@shared/automations/automation-run';

interface AutomationRunsFilterBarProps {
  filters: AutomationRunsFacetFilters;
  options: AutomationRunsFilterOptions;
  onChange: (filters: AutomationRunsFacetFilters) => void;
}

export function AutomationRunsFilterBar({
  filters,
  options,
  onChange,
}: AutomationRunsFilterBarProps) {
  const timeRangeLabel = useMemo(() => {
    if (!filters.timeRange) return 'Time range';
    return (
      AUTOMATION_RUNS_TIME_RANGE_OPTIONS.find((option) => option.value === filters.timeRange)
        ?.label ?? 'Time range'
    );
  }, [filters.timeRange]);

  return (
    <ListFilterRow heading="Filter:">
      <ListFilterSearchableSelect
        label="Automation"
        items={options.automations}
        selected={filters.automationId}
        onChange={(automationId) => onChange({ ...filters, automationId })}
      />
      <ListFilterSingleSelect<AutomationRunsTimeRange>
        label={timeRangeLabel}
        items={AUTOMATION_RUNS_TIME_RANGE_OPTIONS}
        selected={filters.timeRange}
        onChange={(timeRange) => onChange({ ...filters, timeRange })}
        clearLabel="All time ranges"
      />
      <ListFilterMultiSelect<AutomationRunStatus>
        label="Status"
        items={options.statuses}
        selected={filters.statuses}
        onChange={(statuses) => onChange({ ...filters, statuses })}
        searchable={false}
      />
    </ListFilterRow>
  );
}
