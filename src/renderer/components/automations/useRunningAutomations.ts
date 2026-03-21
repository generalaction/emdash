import { useSyncExternalStore, useCallback } from 'react';

/**
 * Tracks the *brief* triggering phase when a user clicks "Run now".
 *
 * Phases flow: preparing → creating-worktree → saving-task → starting-agent → (auto‑clear)
 *
 * This store does NOT track long‑running agent work. For that, look at
 * the real Task list with `metadata.automationId` + `useTaskStatus`.
 */

export type AutomationRunPhase =
  | 'preparing'
  | 'creating-worktree'
  | 'saving-task'
  | 'starting-agent'
  | 'error';

export interface AutomationRunState {
  automationId: string;
  automationName: string;
  phase: AutomationRunPhase;
  startedAt: number;
  error?: string;
}

const PHASE_LABELS: Record<AutomationRunPhase, string> = {
  preparing: 'Preparing…',
  'creating-worktree': 'Creating worktree…',
  'saving-task': 'Saving task…',
  'starting-agent': 'Starting agent…',
  error: 'Failed',
};

export function getPhaseLabel(phase: AutomationRunPhase): string {
  return PHASE_LABELS[phase];
}

// ---------------------------------------------------------------------------
// Tiny external store — no context wrapper needed
// ---------------------------------------------------------------------------
type Listener = () => void;

let runs: Map<string, AutomationRunState> = new Map();
const listeners: Set<Listener> = new Set();

function emitChange(): void {
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
// Public API — called from useAutomationTrigger
// ---------------------------------------------------------------------------

export function setAutomationRunPhase(
  automationId: string,
  automationName: string,
  phase: AutomationRunPhase,
  extra?: { error?: string }
): void {
  const existing = runs.get(automationId);

  if (phase === 'error') {
    runs.set(automationId, {
      ...(existing ?? { automationId, automationName, startedAt: Date.now() }),
      automationId,
      automationName,
      phase,
      ...extra,
    });
    emitChange();
    // Auto-clear error after a few seconds
    setTimeout(() => {
      runs.delete(automationId);
      emitChange();
    }, 6000);
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

/** Clear the triggering state (called once agent PTY is started) */
export function clearAutomationRun(automationId: string): void {
  if (!runs.has(automationId)) return;
  runs.delete(automationId);
  emitChange();
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------
export function useRunningAutomations() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const getRunState = useCallback(
    (automationId: string): AutomationRunState | undefined => {
      return snapshot.get(automationId);
    },
    [snapshot]
  );

  const triggeringCount = snapshot.size;

  return { getRunState, triggeringCount };
}
