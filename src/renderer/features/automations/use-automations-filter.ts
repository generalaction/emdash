import { useMemo } from 'react';
import { formatRunStatusLabel, formatRunTriggerKindLabel } from '@shared/automations/format';
import type {
  Automation,
  AutomationRun,
  AutomationRunWithContext,
} from '@shared/automations/types';
import {
  getProjectStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';

export interface AutomationsFilterResult {
  query: string;
  drafts: Automation[];
  active: Automation[];
  paused: Automation[];
  hasResults: boolean;
  visibleRuns: AutomationRunWithContext[] | undefined;
  runsByAutomation: Map<string, AutomationRun[]>;
}

interface UseAutomationsFilterOptions {
  automations: readonly Automation[];
  runs: AutomationRunWithContext[] | undefined;
  search: string;
  runsVisibleLimit: number;
}

export function useAutomationsFilter({
  automations,
  runs,
  search,
  runsVisibleLimit,
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

  const visibleRuns = useMemo(() => {
    if (!runs) return undefined;
    const matched = query ? runs.filter((run) => runMatchesQuery(run, query)) : runs;
    return matched.slice(0, runsVisibleLimit);
  }, [runs, query, runsVisibleLimit]);

  return {
    query,
    drafts,
    active,
    paused,
    hasResults: filtered.length > 0,
    visibleRuns,
    runsByAutomation,
  };
}

function runMatchesQuery(run: AutomationRunWithContext, query: string): boolean {
  if (run.automationName.toLowerCase().includes(query)) return true;
  const projectName = run.projectId ? projectDisplayName(getProjectStore(run.projectId)) : null;
  if (projectName && projectName.toLowerCase().includes(query)) return true;
  const statusLabel = formatRunStatusLabel(run.status);
  if (statusLabel && statusLabel.toLowerCase().includes(query)) return true;
  if (formatRunTriggerKindLabel(run.triggerKind).toLowerCase().includes(query)) return true;
  return false;
}
