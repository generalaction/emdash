import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { Automation } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';
import { useAutomationRuns, useAutomations } from './use-automations';

interface AutomationsContextValue {
  automations: Automation[];
  automationsIsPending: boolean;
}

const AutomationsContext = createContext<AutomationsContextValue | null>(null);

export function AutomationsProvider({ children }: { children: ReactNode }) {
  const { automations } = useAutomations();

  const value = useMemo<AutomationsContextValue>(
    () => ({
      automations: automations.data ?? [],
      automationsIsPending: automations.isPending,
    }),
    [automations.data, automations.isPending]
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
  const runs = useAutomationRuns(id);
  return runs.data?.[0];
}

export function useToggleAutomation(): (id: string, enabled: boolean) => void {
  return useCallback((_id: string, _enabled: boolean) => {
    // setEnabled not yet implemented
  }, []);
}

/** Returns a single run from the automation's cached run list. */
export function useAutomationRun(automationId: string, runId: string): AutomationRun | undefined {
  const runs = useAutomationRuns(automationId);
  return useMemo(() => runs.data?.find((r) => r.id === runId), [runs.data, runId]);
}
