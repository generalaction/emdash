/**
 * TDD test: respawn suppression keys off this.multiplexer, not this.tmux.
 * When a multiplexer backend is set, an unexpected child exit must NOT trigger
 * a respawn. When multiplexer is null, the provider must respawn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PtyExitInfo } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { tmuxBackend } from '@main/core/pty/multiplexer/tmux';
import type { MultiplexerBackend } from '@main/core/pty/multiplexer';
import { agentSessionExitedChannel } from '@shared/core/agents/agentEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import { LocalConversationProvider } from './local-conversation';

const spawnLocalPty = vi.hoisted(() => vi.fn());
const resolveLocalPtySpawnMock = vi.hoisted(() =>
  vi.fn(() => ({ command: 'sh', args: [], cwd: '/tmp/task-1', warnings: [] as string[] }))
);
const buildCommandMock = vi.hoisted(() =>
  vi.fn((_ctx: Record<string, unknown>) => ({
    command: 'agent',
    args: [] as string[],
    env: {} as Record<string, string>,
  }))
);

vi.mock('@main/core/dependencies/host-dependency-store', () => ({
  hostDependencyStore: {
    getSelection: vi.fn().mockResolvedValue(null),
    setSelection: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@main/core/agent-hooks/agent-hook-service', () => ({
  agentHookService: {
    getPort: vi.fn(() => 0),
    getToken: vi.fn(() => 'token'),
  },
}));

vi.mock('@main/core/agent-hooks/workspace-trust-service', () => ({
  workspaceTrustService: {
    maybeAutoTrustLocal: vi.fn(),
    maybeAutoTrustSsh: vi.fn(),
  },
}));

vi.mock('@main/core/agents/plugin-registry', () => ({
  getPlugin: vi.fn((id: string) => ({
    metadata: { id },
    capabilities: {
      hostDependency: { binaryNames: [id] },
      hooks: { kind: 'none' },
      prompt: { kind: 'argv', flag: '' },
    },
    behavior: {
      prompt: { buildCommand: buildCommandMock },
      hooks: {
        writeHooks: vi.fn(async () => []),
        deleteHooks: vi.fn(),
        readHooks: vi.fn(),
        getHooksInstalled: vi.fn(),
      },
      plugins: {
        installPlugin: vi.fn(async () => []),
        uninstallPlugin: vi.fn(),
        isPluginInstalled: vi.fn(),
        getPluginVersion: vi.fn(),
        getPluginPath: vi.fn(),
      },
    },
  })),
}));

vi.mock('@main/core/agents/plugin-fs', () => ({
  createPluginFs: vi.fn(() => ({
    read: vi.fn(async () => null),
    write: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => false),
    list: vi.fn(async () => []),
  })),
}));

vi.mock('@main/core/pty/local-pty', () => ({
  spawnLocalPty,
}));

vi.mock('@main/core/pty/pty-spawn-platform', () => ({
  resolveLocalPtySpawn: resolveLocalPtySpawnMock,
  logLocalPtySpawnWarnings: vi.fn(),
}));

vi.mock('./keystroke-injection', () => ({
  scheduleInitialPromptInjection: vi.fn(),
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

vi.mock('@main/core/dependencies/dependency-managers', () => ({
  localDependencyManager: {
    get: vi.fn(() => undefined),
  },
  getDependencyManager: vi.fn(async () => ({
    get: vi.fn(() => undefined),
  })),
}));

vi.mock('./resolve-agent-executable', () => ({
  resolveAgentExecutable: vi.fn(async ({ binaryName }: { binaryName: string }) => binaryName),
  clearResolvedPathCache: vi.fn(),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn(async (key: string) =>
      key === 'terminal'
        ? {
            autoCopyOnSelection: false,
            macOptionIsMeta: false,
            defaultShell: 'system',
            fontSize: 13,
          }
        : {
            defaultProjectsDirectory: '',
            defaultWorktreeDirectory: '',
            writeAgentConfigToGitIgnore: true,
          }
    ),
  },
}));

const { events } = await import('@main/lib/events');

const DEFAULT_SHELL_PROFILE: ConstructorParameters<
  typeof LocalConversationProvider
>[0]['shellProfile'] = {
  id: 'sh',
  resolvedShellId: 'sh',
  resolvedFromSystem: true,
  executable: 'sh',
  available: true,
  family: 'posix',
  interactiveArgs: ['-i'],
  commandArgs: ['-c'],
};

function makeProvider(multiplexer: MultiplexerBackend | null) {
  return new LocalConversationProvider({
    projectId: 'project-1',
    taskId: 'task-1',
    taskPath: '/tmp/task-1',
    multiplexer,
    shellProfile: DEFAULT_SHELL_PROFILE,
    ctx: {} as never,
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

function fakePty(exitHandlers: Array<(info: PtyExitInfo) => void>): ReturnType<typeof spawnLocalPty> {
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn((handler: (info: PtyExitInfo) => void) => exitHandlers.push(handler)),
  };
}

describe('LocalConversationProvider multiplexer-based respawn suppression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnLocalPty.mockReset();
    resolveLocalPtySpawnMock.mockReset();
    resolveLocalPtySpawnMock.mockReturnValue({
      command: 'sh',
      args: [],
      cwd: '/tmp/task-1',
      warnings: [],
    });
    buildCommandMock.mockReset();
    buildCommandMock.mockReturnValue({ command: 'agent', args: [], env: {} });
    vi.mocked(events.emit).mockClear();
    ptySessionRegistry.unregister('project-1:task-1:conversation-1');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not respawn when a multiplexer backend is set (suppressed)', async () => {
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    spawnLocalPty.mockReturnValue(fakePty(exitHandlers));
    const provider = makeProvider(tmuxBackend);
    const item = conversation();

    await provider.startSession(item);
    vi.mocked(events.emit).mockClear();
    for (const handler of exitHandlers) handler({ exitCode: 0 });
    await vi.advanceTimersByTimeAsync(600);

    // Must not respawn
    expect(spawnLocalPty).toHaveBeenCalledTimes(1);
    // Must emit session exited (the multiplexer owns the session, agent detached)
    expect(events.emit).toHaveBeenCalledWith(
      agentSessionExitedChannel,
      expect.objectContaining({ conversationId: item.id })
    );
  });

  it('does respawn when multiplexer is null (normal respawn)', async () => {
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    spawnLocalPty.mockImplementation(() => {
      const handlers: Array<(info: PtyExitInfo) => void> = [];
      exitHandlers.push(...handlers);
      return fakePty(handlers);
    });
    // Use two separate mocks so we capture both spawns
    const h1: Array<(info: PtyExitInfo) => void> = [];
    spawnLocalPty.mockReturnValueOnce(fakePty(h1));
    const h2: Array<(info: PtyExitInfo) => void> = [];
    spawnLocalPty.mockReturnValueOnce(fakePty(h2));

    const provider = makeProvider(null);
    const item = conversation();

    await provider.startSession(item);
    for (const handler of h1) handler({ exitCode: 1 });
    await vi.advanceTimersByTimeAsync(600);

    // Must respawn
    expect(spawnLocalPty).toHaveBeenCalledTimes(2);
  });

  it('sets multiplexer config on the spawn intent when backend is set', async () => {
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    spawnLocalPty.mockReturnValue(fakePty(exitHandlers));

    const provider = makeProvider(tmuxBackend);
    const item = conversation();
    await provider.startSession(item);

    expect(spawnLocalPty).toHaveBeenCalledTimes(1);
    // The intent passed to resolveLocalPtySpawn must carry the multiplexer backend id.
    expect(resolveLocalPtySpawnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intent: expect.objectContaining({
          multiplexer: expect.objectContaining({ id: tmuxBackend.id }),
        }),
      })
    );
  });
});
