import { useEffect } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import type { DevBackgroundShutdownSimulatedEvent } from '@shared/events/appEvents';

const SESSION_KEY = 'emdash:dev-app-close-sim';

function useMountEffect(effect: () => void | (() => void)): void {
  // eslint-disable-next-line no-restricted-syntax
  // oxlint-disable-next-line react/exhaustive-deps
  useEffect(effect, []);
}

function readSimulatedClosePayload(): DevBackgroundShutdownSimulatedEvent | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(SESSION_KEY);
  try {
    return JSON.parse(raw) as DevBackgroundShutdownSimulatedEvent;
  } catch {
    return null;
  }
}

export function DevShutdownEvents() {
  useMountEffect(() => {
    if (!import.meta.env.DEV) return;

    const payload = readSimulatedClosePayload();
    if (!payload) return;

    const checkedSessions = payload.sessions.filter((s) => s.tmuxAlive !== undefined);
    const alive = checkedSessions.filter((s) => s.tmuxAlive).length;
    const total = payload.sessions.length;
    const unchecked = total - checkedSessions.length;
    const checkedSummary =
      checkedSessions.length > 0
        ? `${alive}/${checkedSessions.length} checked agent session(s) kept running in the background.`
        : 'No agent sessions could be checked.';

    toast({
      title: 'App close simulated',
      description:
        total > 0
          ? `${checkedSummary}${unchecked > 0 ? ` ${unchecked} remote or non-tmux session(s) were not checked.` : ''} Navigate back to your task — the agent should still be running with new output.`
          : 'Navigate to a task with a running agent to verify sessions survive a close.',
    });
  });

  return null;
}
