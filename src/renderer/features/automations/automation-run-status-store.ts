import { useSyncExternalStore } from 'react';
import type { AutomationRunStatus } from '@shared/automations/types';

export type AutomationRunStatusSnapshot = {
  runId: string;
  status: AutomationRunStatus;
  taskId?: string | null;
  updatedAt: number;
};

const statuses = new Map<string, AutomationRunStatusSnapshot>();
const listeners = new Set<() => void>();
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>();

function notify() {
  listeners.forEach((listener) => listener());
}

function scheduleClear(automationId: string) {
  const existing = clearTimers.get(automationId);
  if (existing) clearTimeout(existing);

  clearTimers.set(
    automationId,
    setTimeout(() => {
      clearTimers.delete(automationId);
      const current = statuses.get(automationId);
      if (current?.status === 'running') return;
      statuses.delete(automationId);
      notify();
    }, 8000)
  );
}

export function updateAutomationRunStatus(
  automationId: string,
  snapshot: Omit<AutomationRunStatusSnapshot, 'updatedAt'>
) {
  statuses.set(automationId, { ...snapshot, updatedAt: Date.now() });

  if (snapshot.status === 'running') {
    const existing = clearTimers.get(automationId);
    if (existing) {
      clearTimeout(existing);
      clearTimers.delete(automationId);
    }
  } else {
    scheduleClear(automationId);
  }

  notify();
}

export function useAutomationRunStatus(
  automationId: string
): AutomationRunStatusSnapshot | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => statuses.get(automationId),
    () => undefined
  );
}
