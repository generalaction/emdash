import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import type { Conversation } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { LocalConversationProvider } from './local-conversation';
import { SshConversationProvider } from './ssh-conversation';

const spawnLocalPty = vi.hoisted(() => vi.fn());
const openSsh2Pty = vi.hoisted(() => vi.fn());

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

vi.mock('@main/core/pty/local-pty', () => ({
  spawnLocalPty,
}));

vi.mock('@main/core/pty/spawn-utils', () => ({
  resolveSshCommand: vi.fn(() => 'ssh command'),
}));

vi.mock('@main/core/pty/ssh2-pty', () => ({
  openSsh2Pty,
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

type RespawnState = {
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
  });

  it('preserves resume mode when a local resumed session respawns', async () => {
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

  it('preserves resume mode when an SSH resumed session respawns', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
      openSsh2Pty.mockResolvedValue({ success: true, data: fakePty(exitHandlers) });
      const provider = sshProvider();
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

      for (const handler of secondExitHandlers) handler({ exitCode: 127 });
      await vi.advanceTimersByTimeAsync(500);

      expect(proxy.refreshRemoteShellProfile).toHaveBeenCalledTimes(1);
      expect(openSsh2Pty).toHaveBeenCalledTimes(2);
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
});
