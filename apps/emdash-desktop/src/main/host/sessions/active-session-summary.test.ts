import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getActiveSessionSummary } from './active-session-summary';

const mocks = vi.hoisted(() => ({
  getAcpRuntimeClient: vi.fn(),
  getTerminalsRuntimeClient: vi.fn(),
  getTuiAgentsRuntimeClient: vi.fn(),
}));

vi.mock('@main/gateway/accessors', () => mocks);
vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn() },
}));

beforeEach(() => {
  mocks.getAcpRuntimeClient.mockReset();
  mocks.getTerminalsRuntimeClient.mockReset();
  mocks.getTuiAgentsRuntimeClient.mockReset();
});

describe('getActiveSessionSummary', () => {
  it('counts active ACP, local and remote TUI, and terminal sessions', async () => {
    mocks.getAcpRuntimeClient.mockResolvedValue(
      clientWithSessions({
        working: { lifecycle: 'working', isGenerating: false },
        generating: { lifecycle: 'ready', isGenerating: true },
        idle: { lifecycle: 'ready', isGenerating: false },
      })
    );
    mocks.getTuiAgentsRuntimeClient.mockResolvedValue(
      clientWithSessions({
        local: { status: 'running', isRemote: false },
        remote: { status: 'running', isRemote: true },
        starting: { status: 'starting', isRemote: false },
        exited: { status: 'exited', isRemote: false },
      })
    );
    mocks.getTerminalsRuntimeClient.mockResolvedValue(
      clientWithSessions({
        terminal: { status: 'running', kind: 'terminal' },
        workflow: { status: 'running', kind: 'workflow' },
        exited: { status: 'exited', kind: 'terminal' },
      })
    );

    await expect(getActiveSessionSummary()).resolves.toEqual({
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
    mocks.getAcpRuntimeClient.mockReturnValue(
      new Promise((_, reject) => {
        rejectLateRead = reject;
      })
    );
    mocks.getTuiAgentsRuntimeClient.mockResolvedValue(clientWithSessions({}));
    mocks.getTerminalsRuntimeClient.mockResolvedValue(clientWithSessions({}));

    const pending = getActiveSessionSummary();
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
    mocks.getAcpRuntimeClient.mockRejectedValue(new Error('worker unavailable'));
    mocks.getTuiAgentsRuntimeClient.mockResolvedValue(clientWithSessions({}));
    mocks.getTerminalsRuntimeClient.mockResolvedValue(clientWithSessions({}));

    await expect(getActiveSessionSummary()).resolves.toEqual({
      acpSessions: 0,
      localTuiSessions: 0,
      remoteTuiSessions: 0,
      terminals: 0,
      incomplete: true,
    });
  });
});

function clientWithSessions(data: Record<string, unknown>) {
  return {
    sessions: {
      state: () => ({
        snapshot: async () => ({ data }),
      }),
    },
  };
}
