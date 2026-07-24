import { describe, expect, it, vi } from 'vitest';
import { getActiveSessionSummary } from './active-session-summary';

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn() },
}));

describe('getActiveSessionSummary', () => {
  it('counts active ACP, local and remote TUI, and terminal sessions', async () => {
    const clients = {
      acp: clientWithSessions({
        working: { lifecycle: 'working', isGenerating: false },
        generating: { lifecycle: 'ready', isGenerating: true },
        idle: { lifecycle: 'ready', isGenerating: false },
      }),
      tuiAgents: clientWithSessions({
        local: { status: 'running', isRemote: false },
        remote: { status: 'running', isRemote: true },
        starting: { status: 'starting', isRemote: false },
        exited: { status: 'exited', isRemote: false },
      }),
      terminals: clientWithSessions({
        terminal: { status: 'running', kind: 'terminal' },
        workflow: { status: 'running', kind: 'workflow' },
        exited: { status: 'exited', kind: 'terminal' },
      }),
    };

    await expect(getActiveSessionSummary(clients as never)).resolves.toEqual({
      acpSessions: 2,
      localTuiSessions: 1,
      remoteTuiSessions: 1,
      terminals: 1,
      incomplete: false,
    });
  });

  it('marks the summary incomplete when a worker read misses the deadline', async () => {
    vi.useFakeTimers();
    let rejectLateRead!: (error: Error) => void;
    const clients = {
      acp: clientWithSnapshot(
        () =>
          new Promise((_, reject) => {
            rejectLateRead = reject;
          })
      ),
      tuiAgents: clientWithSessions({}),
      terminals: clientWithSessions({}),
    };

    const pending = getActiveSessionSummary(clients as never);
    await vi.advanceTimersByTimeAsync(500);

    await expect(pending).resolves.toEqual({
      acpSessions: 0,
      localTuiSessions: 0,
      remoteTuiSessions: 0,
      terminals: 0,
      incomplete: true,
    });
    rejectLateRead(new Error('late worker failure'));
    await Promise.resolve();
    vi.useRealTimers();
  });

  it('marks the summary incomplete when a worker read fails', async () => {
    const clients = {
      acp: clientWithSnapshot(async () => {
        throw new Error('worker unavailable');
      }),
      tuiAgents: clientWithSessions({}),
      terminals: clientWithSessions({}),
    };

    await expect(getActiveSessionSummary(clients as never)).resolves.toEqual({
      acpSessions: 0,
      localTuiSessions: 0,
      remoteTuiSessions: 0,
      terminals: 0,
      incomplete: true,
    });
  });
});

function clientWithSessions(data: Record<string, unknown>) {
  return clientWithSnapshot(async () => ({ data }));
}

function clientWithSnapshot(snapshot: () => Promise<unknown>) {
  return {
    sessions: {
      state: () => ({ snapshot }),
    },
  };
}
