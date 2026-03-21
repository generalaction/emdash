import { useSyncExternalStore, useCallback } from 'react';

export type AutomationRunPhase =
  | 'preparing'
  | 'creating-worktree'
  | 'saving-task'
  | 'starting-agent'
  | 'running'
  | 'done'
  | 'error';

export interface AutomationRunState {
  automationId: string;
  automationName: string;
  phase: AutomationRunPhase;
  startedAt: number;
  taskId?: string;
  error?: string;
}

const PHASE_LABELS: Record<AutomationRunPhase, string> = {
  preparing: 'Preparing…',
  'creating-worktree': 'Creating worktree…',
  'saving-task': 'Saving task…',
  'starting-agent': 'Starting agent…',
  running: 'Agent is running',
  done: 'Completed',
  error: 'Failed',
};

export function getPhaseLabel(phase: AutomationRunPhase): string {
  return PHASE_LABELS[phase];
}

// ---------------------------------------------------------------------------
// Tiny external store so any component can subscribe without a context wrapper
// ---------------------------------------------------------------------------
type Listener = () => void;

let runs: Map<string, AutomationRunState> = new Map();
const listeners: Set<Listener> = new Set();

function emitChange(): void {
  // Create a new Map reference so useSyncExternalStore sees a change
  runs = new Map(runs);
  for (const l of listeners) l();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Map<string, AutomationRunState> {
  return runs;
}

// ---------------------------------------------------------------------------
// Public mutation API (called from useAutomationTrigger)
// ---------------------------------------------------------------------------
export function setAutomationRunPhase(
  automationId: string,
  automationName: string,
  phase: AutomationRunPhase,
  extra?: { taskId?: string; error?: string }
): void {
  const existing = runs.get(automationId);
  if (phase === 'done') {
    // Remove after a short delay so the user sees the "done" briefly
    runs.set(automationId, {
      ...(existing ?? { automationId, automationName, startedAt: Date.now() }),
      automationId,
      automationName,
      phase,
      ...extra,
    });
    emitChange();
    setTimeout(() => {
      runs.delete(automationId);
      emitChange();
    }, 3000);
    return;
  }
  if (phase === 'error') {
    runs.set(automationId, {
      ...(existing ?? { automationId, automationName, startedAt: Date.now() }),
      automationId,
      automationName,
      phase,
      ...extra,
    });
    emitChange();
    // Keep error visible a bit longer, then clean up
    setTimeout(() => {
      runs.delete(automationId);
      emitChange();
    }, 8000);
    return;
  }
  runs.set(automationId, {
    automationId,
    automationName,
    startedAt: existing?.startedAt ?? Date.now(),
    phase,
    ...extra,
  });
  emitChange();
}

export function clearAutomationRun(automationId: string): void {
  runs.delete(automationId);
  emitChange();
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------
export function useRunningAutomations() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const isRunning = useCallback(
    (automationId: string): boolean => {
      const r = snapshot.get(automationId);
      return !!r && r.phase !== 'done' && r.phase !== 'error';
    },
    [snapshot]
  );

  const getRunState = useCallback(
    (automationId: string): AutomationRunState | undefined => {
      return snapshot.get(automationId);
    },
    [snapshot]
  );

  const allRunning = Array.from(snapshot.values()).filter(
    (r) => r.phase !== 'done' && r.phase !== 'error'
  );

  return { isRunning, getRunState, allRunning, snapshot };
}
