import type { UseMutationResult } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { isQueueDeadlineExceededRun } from '@shared/automations/format';
import type {
  Automation,
  AutomationRun,
  AutomationRunWithContext,
} from '@shared/automations/types';
import { useAutomations, useRecentAutomationRuns, useAutomationRuns } from './useAutomations';

const RECENT_RUNS_LIMIT = 200;

interface AutomationsContextValue {
  automations: Automation[];
  automationsIsPending: boolean;
  recentRuns: { data: AutomationRunWithContext[] | undefined; isPending: boolean };
  runsByAutomation: Map<string, AutomationRun[]>;
  setEnabled: UseMutationResult<Automation, Error, { id: string; enabled: boolean }>;
}

const AutomationsContext = createContext<AutomationsContextValue | null>(null);

export function AutomationsProvider({ children }: { children: ReactNode }) {
  const { automations, setEnabled } = useAutomations();
  const recentRunsQuery = useRecentAutomationRuns(undefined, RECENT_RUNS_LIMIT);

  const runsByAutomation = useMemo(() => {
    const map = new Map<string, AutomationRun[]>();
    for (const run of recentRunsQuery.data ?? []) {
      if (isQueueDeadlineExceededRun(run)) continue;
      const list = map.get(run.automationId);
      if (list) list.push(run);
      else map.set(run.automationId, [run]);
    }
    return map;
  }, [recentRunsQuery.data]);

  const value = useMemo<AutomationsContextValue>(
    () => ({
      automations: automations.data ?? [],
      automationsIsPending: automations.isPending,
      recentRuns: { data: recentRunsQuery.data, isPending: recentRunsQuery.isPending },
      runsByAutomation,
      setEnabled,
    }),
    [
      automations.data,
      automations.isPending,
      recentRunsQuery.data,
      recentRunsQuery.isPending,
      runsByAutomation,
      setEnabled,
    ]
  );

  return <AutomationsContext.Provider value={value}>{children}</AutomationsContext.Provider>;
}

export function useAutomationsContext(): AutomationsContextValue {
  const ctx = useContext(AutomationsContext);
  if (!ctx) throw new Error('useAutomationsContext must be used within AutomationsProvider');
  return ctx;
}

export function useAutomation(id: string): Automation | undefined {
  const { automations } = useAutomationsContext();
  return useMemo(() => automations.find((a) => a.id === id), [automations, id]);
}

export function useAutomationLatestRun(id: string): AutomationRun | undefined {
  const { runsByAutomation } = useAutomationsContext();
  return runsByAutomation.get(id)?.[0];
}

export function useToggleAutomation(): (id: string, enabled: boolean) => void {
  const { setEnabled } = useAutomationsContext();
  return useCallback(
    (id: string, enabled: boolean) => setEnabled.mutate({ id, enabled }),
    [setEnabled]
  );
}

/** Returns a single run from the automation's cached run list. */
export function useAutomationRun(automationId: string, runId: string): AutomationRun | undefined {
  const runs = useAutomationRuns(automationId);
  return useMemo(() => runs.data?.find((r) => r.id === runId), [runs.data, runId]);
}
