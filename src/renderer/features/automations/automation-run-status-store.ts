import { useSyncExternalStore } from 'react';
import type { AgentStatus } from '@renderer/features/tasks/conversations/conversation-manager';
import type { AutomationRunStatus } from '@shared/automations/automation-run';

export type AutomationRunStatusSnapshot = {
  runId: string;
  status: AutomationRunStatus;
  taskId?: string | null;
  updatedAt: number;
};

export type AutomationAgentActivitySnapshot = {
  taskId: string;
  status: AgentStatus;
  updatedAt: number;
};

const statuses = new Map<string, AutomationRunStatusSnapshot>();
const agentActivities = new Map<string, AutomationAgentActivitySnapshot>();
const listeners = new Set<() => void>();
const clearTimers = new Map<string, ReturnType<typeof setTimeout>>();
const agentClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
      if (current?.status === 'queued' || current?.status === 'running') return;
      statuses.delete(automationId);
      notify();
    }, 8000)
  );
}

function clearAgentTimer(taskId: string) {
  const existing = agentClearTimers.get(taskId);
  if (!existing) return;
  clearTimeout(existing);
  agentClearTimers.delete(taskId);
}

function scheduleAgentClear(taskId: string) {
  clearAgentTimer(taskId);

  agentClearTimers.set(
    taskId,
    setTimeout(() => {
      agentClearTimers.delete(taskId);
      const current = agentActivities.get(taskId);
      if (current?.status === 'working' || current?.status === 'awaiting-input') return;
      agentActivities.delete(taskId);
      notify();
    }, 8000)
  );
}

export function updateAutomationRunStatus(
  automationId: string,
  snapshot: Omit<AutomationRunStatusSnapshot, 'updatedAt'>
) {
  statuses.set(automationId, { ...snapshot, updatedAt: Date.now() });

  if (snapshot.status === 'queued' || snapshot.status === 'running') {
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

export function updateAutomationAgentActivity(taskId: string, status: AgentStatus) {
  if (status === 'idle') {
    clearAgentTimer(taskId);
    if (!agentActivities.delete(taskId)) return;
    notify();
    return;
  }

  agentActivities.set(taskId, { taskId, status, updatedAt: Date.now() });

  if (status === 'working' || status === 'awaiting-input') {
    clearAgentTimer(taskId);
  } else {
    scheduleAgentClear(taskId);
  }

  notify();
}

export function clearAutomationAgentWorking(taskId: string) {
  const current = agentActivities.get(taskId);
  if (current?.status !== 'working' && current?.status !== 'awaiting-input') return;
  clearAgentTimer(taskId);
  agentActivities.delete(taskId);
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

export function useAutomationAgentActivity(
  taskId: string | null | undefined
): AutomationAgentActivitySnapshot | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (taskId ? agentActivities.get(taskId) : undefined),
    () => undefined
  );
}
