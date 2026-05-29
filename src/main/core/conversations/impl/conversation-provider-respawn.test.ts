import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import type { Conversation } from '@shared/conversations';
import { agentSessionExitedChannel } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { LocalConversationProvider } from './local-conversation';
import { SshConversationProvider } from './ssh-conversation';

const spawnLocalPty = vi.hoisted(() => vi.fn());
const openSsh2Pty = vi.hoisted(() => vi.fn());
const agentSessionEmit = vi.hoisted(() => vi.fn());
const killTmuxSession = vi.hoisted(() => vi.fn());

vi.mock('@main/core/agent-hooks/agent-hook-service', () => ({
  agentHookService: {
    getPort: vi.fn(() => 0),
    getToken: vi.fn(() => 'token'),
  },
}));

vi.mock('@main/core/agent-hooks/classifier-wiring', () => ({
  wireAgentClassifier: vi.fn(),
}));

vi.mock('@main/core/agent-hooks/claude-trust-service', () => ({
  claudeTrustService: {
    maybeAutoTrustLocal: vi.fn(),
    maybeAutoTrustSsh: vi.fn(),
  },
}));

vi.mock('@main/core/agent-hooks/hook-config', () => ({
  HookConfigWriter: class {
    writeForProvider = vi.fn(async () => false);
  },
}));

vi.mock('@main/core/conversations/agent-session-events', () => ({
  agentSessionEvents: {
    _emit: agentSessionEmit,
  },
}));

vi.mock('@main/core/pty/local-pty', () => ({
  spawnLocalPty,
}));

vi.mock('@main/core/pty/spawn-utils', () => ({
  resolveSshCommand: vi.fn(() => 'ssh command'),
}));

vi.mock('@main/core/pty/ssh2-pty', () => ({
  openSsh2Pty,
}));

vi.mock('@main/core/pty/tmux-session-name', () => ({
  killTmuxSession,
  makeTmuxSessionName: vi.fn((sessionId: string) => `tmux-${sessionId}`),
}));

vi.mock('./agent-command', () => ({
  buildAgentSessionCommand: vi.fn(() => ({ command: 'agent', args: [] })),
}));

vi.mock('./keystroke-injection', () => ({
  scheduleInitialPromptInjection: vi.fn(),
}));

vi.mock('./provider-env', () => ({
  resolveProviderEnv: vi.fn(() => ({})),
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => () => {}),
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: vi.fn(),
  },
}));

vi.mock('@main/core/settings/provider-settings-service', () => ({
  providerOverrideSettings: {
    getItem: vi.fn(async () => undefined),
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn(async () => ({ writeAgentConfigToGitIgnore: true })),
  },
}));

const { events } = await import('@main/lib/events');

type RespawnState = {
  knownSessionIds: Set<string>;
  respawnCounts: Map<string, number>;
};

function localProvider() {
  return new LocalConversationProvider({
    projectId: 'project-1',
    taskId: 'task-1',
    taskPath: '/tmp/task-1',
    ctx: {} as never,
  });
}

function sshProvider(proxy = { getRemoteShellProfile: vi.fn(async () => ({})) }) {
  return new SshConversationProvider({
    projectId: 'project-1',
    taskId: 'task-1',
    taskPath: '/tmp/task-1',
    ctx: {} as never,
    proxy: proxy as never,
  });
}

function conversation(): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: 'Conversation 1',
    lastInteractedAt: null,
    providerSessionId: 'provider-session-1',
    isInitialConversation: false,
    runtimeMode: 'terminal',
  };
}

function fakePty(exitHandlers: Array<(info: PtyExitInfo) => void>): Pty {
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn((handler) => exitHandlers.push(handler)),
  };
}

describe('conversation provider respawn state', () => {
  beforeEach(() => {
    vi.useRealTimers();
    spawnLocalPty.mockReset();
    openSsh2Pty.mockReset();
    agentSessionEmit.mockReset();
    killTmuxSession.mockReset();
    vi.mocked(events.emit).mockClear();
  });

  it('preserves resume mode when a local resumed session respawns within budget', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
      spawnLocalPty.mockReturnValue(fakePty(exitHandlers));
      const provider = localProvider();
      const size = { cols: 100, rows: 40 };
      const initialPrompt = 'continue';
      const item = { ...conversation(), providerSessionId: undefined };

      await provider.startSession(item, size, true, initialPrompt);
      const respawn = vi.spyOn(provider, 'startSession').mockResolvedValue(undefined);

      for (const handler of exitHandlers) handler({ exitCode: 1 });
      await vi.advanceTimersByTimeAsync(500);

      expect(agentSessionEmit).toHaveBeenCalledWith(
        'agent:session-exited',
        expect.objectContaining({ conversationId: 'conversation-1' })
      );
      expect(respawn).toHaveBeenCalledWith(item, size, true, initialPrompt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves resume mode when an SSH resumed session respawns within budget', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
      openSsh2Pty.mockResolvedValue({ success: true, data: fakePty(exitHandlers) });
      const provider = sshProvider();
      const size = { cols: 100, rows: 40 };
      const initialPrompt = 'continue';
      const item = { ...conversation(), providerSessionId: undefined };

      await provider.startSession(item, size, true, initialPrompt);
      const respawn = vi.spyOn(provider, 'startSession').mockResolvedValue(undefined);

      for (const handler of exitHandlers) handler({ exitCode: 1 });
      await vi.advanceTimersByTimeAsync(500);

      expect(respawn).toHaveBeenCalledWith(item, size, true, initialPrompt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves resume mode on immediate exit within budget', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
      spawnLocalPty.mockReturnValue(fakePty(exitHandlers));
      const provider = localProvider();
      const size = { cols: 100, rows: 40 };
      const initialPrompt = 'continue';
      const item = conversation();

      await provider.startSession(item, size, true, initialPrompt);
      const respawn = vi.spyOn(provider, 'startSession').mockResolvedValue(undefined);

      for (const handler of exitHandlers) handler({ exitCode: 1 });
      await vi.advanceTimersByTimeAsync(500);

      expect(respawn).toHaveBeenCalledWith(item, size, true, initialPrompt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to fresh local session after resume exceeds respawn budget', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      spawnLocalPty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return fakePty(handlers);
      });
      const provider = localProvider();
      const startSession = vi.spyOn(provider, 'startSession');
      const size = { cols: 100, rows: 40 };
      const initialPrompt = 'continue';
      const item = conversation();

      await provider.startSession(item, size, true, initialPrompt);

      for (const handler of exitHandlers[0] ?? []) handler({ exitCode: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(startSession).toHaveBeenLastCalledWith(item, size, true, initialPrompt);

      for (const handler of exitHandlers[1] ?? []) handler({ exitCode: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(startSession).toHaveBeenLastCalledWith(item, size, true, initialPrompt);

      for (const handler of exitHandlers[2] ?? []) handler({ exitCode: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(startSession).toHaveBeenLastCalledWith(item, size, false, initialPrompt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to fresh SSH session after resume exceeds respawn budget', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      openSsh2Pty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return Promise.resolve({ success: true, data: fakePty(handlers) });
      });
      const provider = sshProvider();
      const startSession = vi.spyOn(provider, 'startSession');
      const size = { cols: 100, rows: 40 };
      const initialPrompt = 'continue';
      const item = conversation();

      await provider.startSession(item, size, true, initialPrompt);

      for (const handler of exitHandlers[0] ?? []) handler({ exitCode: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(startSession).toHaveBeenLastCalledWith(item, size, true, initialPrompt);

      for (const handler of exitHandlers[1] ?? []) handler({ exitCode: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(startSession).toHaveBeenLastCalledWith(item, size, true, initialPrompt);

      for (const handler of exitHandlers[2] ?? []) handler({ exitCode: 1 });
      await vi.advanceTimersByTimeAsync(500);
      expect(startSession).toHaveBeenLastCalledWith(item, size, false, initialPrompt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes the SSH shell profile and retries once when an agent command is missing', async () => {
    vi.useFakeTimers();
    try {
      const firstExitHandlers: Array<(info: PtyExitInfo) => void> = [];
      const secondExitHandlers: Array<(info: PtyExitInfo) => void> = [];
      openSsh2Pty
        .mockResolvedValueOnce({ success: true, data: fakePty(firstExitHandlers) })
        .mockResolvedValueOnce({ success: true, data: fakePty(secondExitHandlers) });
      const proxy = {
        getRemoteShellProfile: vi.fn(async () => ({})),
        refreshRemoteShellProfile: vi.fn(async () => ({})),
      };
      const provider = sshProvider(proxy);
      const item = conversation();

      await provider.startSession(item);
      for (const handler of firstExitHandlers) handler({ exitCode: 127 });
      await vi.advanceTimersByTimeAsync(500);

      expect(proxy.refreshRemoteShellProfile).toHaveBeenCalledTimes(1);
      expect(openSsh2Pty).toHaveBeenCalledTimes(2);
      expect(events.emit).not.toHaveBeenCalledWith(
        agentSessionExitedChannel,
        expect.objectContaining({ exitCode: 127 })
      );

      for (const handler of secondExitHandlers) handler({ exitCode: 127 });
      await vi.advanceTimersByTimeAsync(500);

      expect(proxy.refreshRemoteShellProfile).toHaveBeenCalledTimes(1);
      expect(openSsh2Pty).toHaveBeenCalledTimes(2);
      expect(events.emit).toHaveBeenCalledWith(
        agentSessionExitedChannel,
        expect.objectContaining({ exitCode: 127 })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears local respawn counts when explicitly stopping a session', async () => {
    const provider = localProvider();
    const sessionId = makePtySessionId('project-1', 'task-1', 'conversation-1');
    (provider as unknown as RespawnState).respawnCounts.set(sessionId, 3);

    await provider.stopSession('conversation-1');

    expect((provider as unknown as RespawnState).respawnCounts.has(sessionId)).toBe(false);
  });

  it('clears SSH respawn counts when explicitly stopping a session', async () => {
    const provider = sshProvider();
    const sessionId = makePtySessionId('project-1', 'task-1', 'conversation-1');
    (provider as unknown as RespawnState).respawnCounts.set(sessionId, 3);

    await provider.stopSession('conversation-1');

    expect((provider as unknown as RespawnState).respawnCounts.has(sessionId)).toBe(false);
  });

  it('keeps local stop best-effort when tmux cleanup fails', async () => {
    killTmuxSession.mockRejectedValueOnce(new Error('tmux failed'));
    const provider = new LocalConversationProvider({
      projectId: 'project-1',
      taskId: 'task-1',
      taskPath: '/tmp/task-1',
      ctx: {} as never,
      tmux: true,
    });

    await expect(provider.stopSession('conversation-1')).resolves.toBeUndefined();

    expect(killTmuxSession).toHaveBeenCalledOnce();
  });

  it('keeps SSH stop best-effort when tmux cleanup fails', async () => {
    killTmuxSession.mockRejectedValueOnce(new Error('tmux failed'));
    const provider = new SshConversationProvider({
      projectId: 'project-1',
      taskId: 'task-1',
      taskPath: '/tmp/task-1',
      ctx: {} as never,
      proxy: { getRemoteShellProfile: vi.fn(async () => ({})) } as never,
      tmux: true,
    });

    await expect(provider.stopSession('conversation-1')).resolves.toBeUndefined();

    expect(killTmuxSession).toHaveBeenCalledOnce();
  });

  it('keeps local destroyAll best-effort when tmux cleanup fails', async () => {
    killTmuxSession.mockRejectedValueOnce(new Error('tmux failed'));
    const provider = new LocalConversationProvider({
      projectId: 'project-1',
      taskId: 'task-1',
      taskPath: '/tmp/task-1',
      ctx: {} as never,
      tmux: true,
    });
    const sessionId = makePtySessionId('project-1', 'task-1', 'conversation-1');
    (provider as unknown as RespawnState).knownSessionIds.add(sessionId);

    await expect(provider.destroyAll()).resolves.toBeUndefined();

    expect(killTmuxSession).toHaveBeenCalledOnce();
    expect((provider as unknown as RespawnState).knownSessionIds.has(sessionId)).toBe(false);
  });

  it('keeps SSH destroyAll best-effort when tmux cleanup fails', async () => {
    killTmuxSession.mockRejectedValueOnce(new Error('tmux failed'));
    const provider = new SshConversationProvider({
      projectId: 'project-1',
      taskId: 'task-1',
      taskPath: '/tmp/task-1',
      ctx: {} as never,
      proxy: { getRemoteShellProfile: vi.fn(async () => ({})) } as never,
      tmux: true,
    });
    const sessionId = makePtySessionId('project-1', 'task-1', 'conversation-1');
    (provider as unknown as RespawnState).knownSessionIds.add(sessionId);

    await expect(provider.destroyAll()).resolves.toBeUndefined();

    expect(killTmuxSession).toHaveBeenCalledOnce();
    expect((provider as unknown as RespawnState).knownSessionIds.has(sessionId)).toBe(false);
  });
});
