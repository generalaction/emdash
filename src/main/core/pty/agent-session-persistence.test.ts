import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtySessionId } from '@shared/ptySessionId';
import type { IExecutionContext } from '../execution-context/types';
import type { Pty } from './pty';
import { ptySessionRegistry } from './pty-session-registry';

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn(async () => ({ tmuxByDefault: false })),
  },
}));

const {
  getProjectTeardownMode,
  hasActiveAgentSessionsForProject,
  hasActivePersistedAgentSessionsForProject,
} = await import('./agent-session-persistence');

class FakePty implements Pty {
  write(): void {}
  resize(): void {}
  kill(): void {}
  onData(): void {}
  onExit(): void {}
}

function makeCtx(tmuxAvailable: boolean): Pick<IExecutionContext, 'exec' | 'supportsLocalSpawn'> {
  return {
    supportsLocalSpawn: false,
    exec: vi.fn(async () => {
      if (!tmuxAvailable) throw new Error('tmux unavailable');
      return { stdout: 'tmux 3.5', stderr: '' };
    }),
  };
}

describe('agent-session-persistence', () => {
  beforeEach(() => {
    for (const session of ptySessionRegistry.listActiveSessions()) {
      ptySessionRegistry.unregister(session.sessionId);
    }
  });

  it('detects active agent sessions for a project', () => {
    const sessionId = makePtySessionId('proj-1', 'task-1', 'conv-1');
    ptySessionRegistry.register(sessionId, new FakePty(), {
      metadata: { providerId: 'claude' },
    });

    expect(hasActiveAgentSessionsForProject('proj-1')).toBe(true);
    expect(hasActiveAgentSessionsForProject('proj-2')).toBe(false);
    expect(hasActivePersistedAgentSessionsForProject('proj-1')).toBe(false);
  });

  it('uses detach on shutdown when persisted agent sessions are active without project tmux', async () => {
    const sessionId = makePtySessionId('proj-1', 'task-1', 'conv-1');
    ptySessionRegistry.register(sessionId, new FakePty(), {
      metadata: { providerId: 'claude', tmuxSessionName: 'emdash-session' },
    });

    expect(hasActivePersistedAgentSessionsForProject('proj-1')).toBe(true);

    const mode = await getProjectTeardownMode('proj-1', {}, makeCtx(false));
    expect(mode).toBe('detach');
  });

  it('uses detach when project tmux is enabled and tmux is available', async () => {
    const mode = await getProjectTeardownMode('proj-1', { tmux: true }, makeCtx(true));

    expect(mode).toBe('detach');
  });

  it('uses terminate when project tmux is enabled but tmux is unavailable', async () => {
    const mode = await getProjectTeardownMode('proj-1', { tmux: true }, makeCtx(false));

    expect(mode).toBe('terminate');
  });

  it('uses terminate when there are no active agent sessions and tmux is off', async () => {
    const mode = await getProjectTeardownMode('proj-1', {}, makeCtx(false));
    expect(mode).toBe('terminate');
  });
});
