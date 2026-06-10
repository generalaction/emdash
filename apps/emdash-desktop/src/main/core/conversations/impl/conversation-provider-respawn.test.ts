import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERSATION_FRESH_RECOVERY_GRACE_MS } from '@main/core/conversations/conversation-session-supervisor';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { agentSessionExitedChannel } from '@shared/core/agents/agentEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import { ptyExitChannel } from '@shared/core/pty/ptyEvents';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import { LocalConversationProvider } from './local-conversation';
import { SshConversationProvider } from './ssh-conversation';

const spawnLocalPty = vi.hoisted(() => vi.fn());
const openSsh2Pty = vi.hoisted(() => vi.fn());
const buildCommandMock = vi.hoisted(() =>
  vi.fn((_ctx: Record<string, unknown>) => ({
    command: 'agent',
    args: [] as string[],
    env: {} as Record<string, string>,
  }))
);
const installPluginMock = vi.hoisted(() => vi.fn(async () => {}));
const writeHooksMock = vi.hoisted(() => vi.fn(async () => {}));

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
    buildCommand: buildCommandMock,
    hooks: {
      writeHooks: writeHooksMock,
      deleteHooks: vi.fn(),
      readHooks: vi.fn(),
      getHooksInstalled: vi.fn(),
    },
    plugin: {
      installPlugin: installPluginMock,
      uninstallPlugin: vi.fn(),
      isPluginInstalled: vi.fn(),
      getPluginVersion: vi.fn(),
      getPluginPath: vi.fn(),
    },
    metadata: {
      id,
      capabilities: {
        install: { binaryNames: [id] },
        hooks: { kind: 'none' },
        promptDelivery: { kind: 'argv', flag: '' },
      },
    },
  })),
  getPluginMetadata: vi.fn((id: string) => ({
    id,
    capabilities: {
      install: { binaryNames: [id] },
      hooks:
        id === 'opencode'
          ? { kind: 'plugin', scope: 'workspace', supportedEvents: [] }
          : { kind: 'none' },
      promptDelivery: { kind: 'argv', flag: '' },
    },
  })),
  WORKSPACE_GITIGNORE_PATHS: {} as Record<string, string[]>,
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

vi.mock('@main/core/pty/spawn-utils', () => ({
  resolveSshCommand: vi.fn(() => 'ssh command'),
}));

vi.mock('@main/core/pty/ssh2-pty', () => ({
  openSsh2Pty,
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

vi.mock('@main/core/dependencies/dependency-manager', () => ({
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
const { agentHookService } = await import('@main/core/agent-hooks/agent-hook-service');
const { appSettingsService } = await import('@main/core/settings/settings-service');

type RespawnState = {
  knownSessionIds: Set<string>;
  sessions: Map<string, Pty>;
};

function localProvider({
  tmux = false,
  shellProfile = {
    id: 'sh',
    resolvedShellId: 'sh',
    resolvedFromSystem: true,
    executable: 'sh',
    available: true,
    family: 'posix',
    interactiveArgs: ['-i'],
    commandArgs: ['-c'],
  },
  ctx = {} as never,
}: {
  tmux?: boolean;
  shellProfile?: ConstructorParameters<typeof LocalConversationProvider>[0]['shellProfile'];
  ctx?: ConstructorParameters<typeof LocalConversationProvider>[0]['ctx'];
} = {}) {
  return new LocalConversationProvider({
    projectId: 'project-1',
    taskId: 'task-1',
    taskPath: '/tmp/task-1',
    tmux,
    shellProfile,
    ctx,
  });
}

function sshProvider(
  proxy = { getRemoteShellProfile: vi.fn(async () => ({})) },
  {
    tmux = false,
    ctx = {} as never,
  }: {
    tmux?: boolean;
    ctx?: ConstructorParameters<typeof SshConversationProvider>[0]['ctx'];
  } = {}
) {
  return new SshConversationProvider({
    projectId: 'project-1',
    taskId: 'task-1',
    taskPath: '/tmp/task-1',
    tmux,
    ctx,
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

function mockSettings(): void {
  vi.mocked(appSettingsService.get).mockImplementation(async (key) => {
    if (key === 'localProject') {
      return {
        defaultProjectsDirectory: '',
        defaultWorktreeDirectory: '',
        writeAgentConfigToGitIgnore: true,
      } as never;
    }
    throw new Error(`Unexpected settings key: ${key}`);
  });
}

describe('conversation provider respawn state', () => {
  beforeEach(() => {
    vi.useRealTimers();
    spawnLocalPty.mockReset();
    openSsh2Pty.mockReset();
    buildCommandMock.mockReset();
    buildCommandMock.mockReturnValue({ command: 'agent', args: [], env: {} });
    installPluginMock.mockReset();
    installPluginMock.mockResolvedValue(undefined);
    writeHooksMock.mockReset();
    writeHooksMock.mockResolvedValue(undefined);
    mockSettings();
    vi.mocked(events.emit).mockClear();
    vi.mocked(agentHookService.getPort).mockReturnValue(0);
    vi.mocked(agentHookService.getToken).mockReturnValue('token');
    ptySessionRegistry.unregister('project-1:task-1:conversation-1');
  });

  it('passes global editor variables to local agent sessions', async () => {
    const previousEditor = process.env.EDITOR;
    const previousShell = process.env.SHELL;
    try {
      process.env.EDITOR = 'zed';
      process.env.SHELL = '/bin/zsh';
      const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
      spawnLocalPty.mockReturnValue(fakePty(exitHandlers));

      await localProvider().startSession(conversation());

      const request = spawnLocalPty.mock.calls[0][0] as { env: Record<string, string> };
      expect(request.env.EDITOR).toBe('zed');
      expect(request.env.SHELL).toBe('sh');
    } finally {
      if (previousEditor === undefined) {
        delete process.env.EDITOR;
      } else {
        process.env.EDITOR = previousEditor;
      }
      if (previousShell === undefined) {
        delete process.env.SHELL;
      } else {
        process.env.SHELL = previousShell;
      }
    }
  });

  it('uses the injected shell profile for local agent sessions', async () => {
    const shellProfile: ConstructorParameters<typeof LocalConversationProvider>[0]['shellProfile'] =
      {
        id: 'bash',
        resolvedShellId: 'bash',
        resolvedFromSystem: false,
        executable: 'bash',
        available: true,
        family: 'posix',
        interactiveArgs: ['-il'],
        commandArgs: ['-lc'],
      };
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    spawnLocalPty.mockReturnValue(fakePty(exitHandlers));

    await localProvider({ shellProfile }).startSession(conversation());

    expect(spawnLocalPty).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'bash',
        args: ['-lc', 'agent'],
      })
    );
  });

  it('sets SHELL to the injected POSIX shell for local agent sessions', async () => {
    const shellProfile: ConstructorParameters<typeof LocalConversationProvider>[0]['shellProfile'] =
      {
        id: 'bash',
        resolvedShellId: 'bash',
        resolvedFromSystem: false,
        executable: '/bin/bash',
        available: true,
        family: 'posix',
        interactiveArgs: ['-il'],
        commandArgs: ['-lc'],
      };
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    spawnLocalPty.mockReturnValue(fakePty(exitHandlers));

    await localProvider({ shellProfile }).startSession(conversation());

    expect(spawnLocalPty).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({ SHELL: '/bin/bash' }),
      })
    );
  });

  it('prepares OpenCode hooks when hook config is available', async () => {
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    spawnLocalPty.mockReturnValue(fakePty(exitHandlers));
    const item = { ...conversation(), providerId: 'opencode' as const };

    await localProvider().startSession(item);

    expect(installPluginMock).toHaveBeenCalledWith(expect.anything(), {
      kind: 'workspace',
      path: '/tmp/task-1',
    });
  });

  it('starts a local conversation fresh after a resumed session exits', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      spawnLocalPty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return fakePty(handlers);
      });
      const provider = localProvider();
      const size = { cols: 100, rows: 40 };
      const initialPrompt = 'continue';
      const item = conversation();

      await provider.startSession(item, size, true, initialPrompt);
      for (const handler of exitHandlers[0] ?? []) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);

      expect(spawnLocalPty).toHaveBeenCalledTimes(2);
      expect(buildCommandMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ isResuming: false })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops local recovery when a fresh fallback exits before the startup grace period', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      spawnLocalPty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return fakePty(handlers);
      });
      const provider = localProvider();
      const item = conversation();

      await provider.startSession(item, undefined, true);
      for (const handler of exitHandlers[0] ?? []) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);
      for (const handler of exitHandlers[1] ?? []) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);

      expect(spawnLocalPty).toHaveBeenCalledTimes(2);
      expect(events.emit).toHaveBeenCalledWith(
        agentSessionExitedChannel,
        expect.objectContaining({
          conversationId: item.id,
          taskId: item.taskId,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a new local recovery cycle after fresh fallback survives the startup grace period', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      spawnLocalPty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return fakePty(handlers);
      });
      const provider = localProvider();
      const item = conversation();

      await provider.startSession(item, undefined, true);
      for (const handler of exitHandlers[0] ?? []) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(CONVERSATION_FRESH_RECOVERY_GRACE_MS);
      for (const handler of exitHandlers[1] ?? []) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);

      expect(spawnLocalPty).toHaveBeenCalledTimes(3);
      expect(buildCommandMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ isResuming: true })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts an SSH conversation fresh after a resumed session exits', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      openSsh2Pty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return Promise.resolve({ success: true, data: fakePty(handlers) });
      });
      const provider = sshProvider();
      const size = { cols: 100, rows: 40 };
      const initialPrompt = 'continue';
      const item = conversation();

      await provider.startSession(item, size, true, initialPrompt);
      for (const handler of exitHandlers[0] ?? []) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);

      expect(openSsh2Pty).toHaveBeenCalledTimes(2);
      expect(buildCommandMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ isResuming: false })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits PTY exit when a local conversation unregisters before the registry exit handler runs', async () => {
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    const exitInfo = { exitCode: 0 };
    spawnLocalPty.mockReturnValue(fakePty(exitHandlers));
    const provider = localProvider();
    const item = conversation();
    const sessionId = makePtySessionId(item.projectId, item.taskId, item.id);

    await provider.startSession(item);
    vi.mocked(events.emit).mockClear();
    for (const handler of exitHandlers) handler(exitInfo);

    expect(events.emit).toHaveBeenCalledWith(ptyExitChannel, exitInfo, sessionId);
  });

  it('emits PTY exit when an SSH conversation unregisters before the registry exit handler runs', async () => {
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    const exitInfo = { exitCode: 0 };
    openSsh2Pty.mockResolvedValue({
      success: true,
      data: fakePty(exitHandlers),
    });
    const provider = sshProvider();
    const item = conversation();
    const sessionId = makePtySessionId(item.projectId, item.taskId, item.id);

    await provider.startSession(item);
    vi.mocked(events.emit).mockClear();
    for (const handler of exitHandlers) handler(exitInfo);

    expect(events.emit).toHaveBeenCalledWith(ptyExitChannel, exitInfo, sessionId);
  });

  it('uses the last observed terminal size when replacing a local conversation', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      spawnLocalPty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return fakePty(handlers);
      });
      const provider = localProvider();
      const item = conversation();
      const sessionId = makePtySessionId(item.projectId, item.taskId, item.id);

      await provider.startSession(item, { cols: 100, rows: 40 }, true);
      ptySessionRegistry.resize(sessionId, 68, 42);
      for (const handler of exitHandlers[0] ?? []) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);

      expect(spawnLocalPty).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ cols: 68, rows: 42 })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the last observed terminal size when replacing an SSH conversation', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      openSsh2Pty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return Promise.resolve({ success: true, data: fakePty(handlers) });
      });
      const provider = sshProvider();
      const item = conversation();
      const sessionId = makePtySessionId(item.projectId, item.taskId, item.id);

      await provider.startSession(item, { cols: 100, rows: 40 }, true);
      ptySessionRegistry.resize(sessionId, 68, 42);
      for (const handler of exitHandlers[0] ?? []) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);

      expect(openSsh2Pty).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ cols: 68, rows: 42 })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a local conversation fresh after one resume replacement exits', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      spawnLocalPty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return fakePty(handlers);
      });
      const provider = localProvider();
      const item = conversation();

      await provider.startSession(item);

      for (let index = 0; index < 2; index += 1) {
        for (const handler of exitHandlers[index] ?? []) handler({ exitCode: 1 });
        await vi.advanceTimersByTimeAsync(500);
      }

      expect(spawnLocalPty).toHaveBeenCalledTimes(3);
      expect(buildCommandMock.mock.calls.map(([args]) => args.isResuming)).toEqual([
        false,
        true,
        false,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts an SSH conversation fresh after one resume replacement exits', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      openSsh2Pty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return Promise.resolve({ success: true, data: fakePty(handlers) });
      });
      const provider = sshProvider();
      const item = conversation();

      await provider.startSession(item);

      for (let index = 0; index < 2; index += 1) {
        for (const handler of exitHandlers[index] ?? []) handler({ exitCode: 1 });
        await vi.advanceTimersByTimeAsync(500);
      }

      expect(openSsh2Pty).toHaveBeenCalledTimes(3);
      expect(buildCommandMock.mock.calls.map(([args]) => args.isResuming)).toEqual([
        false,
        true,
        false,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not loop when local replacement spawn fails', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
      spawnLocalPty.mockReturnValueOnce(fakePty(exitHandlers)).mockImplementationOnce(() => {
        throw new Error('spawn failed');
      });
      const provider = localProvider();
      const item = conversation();

      await provider.startSession(item);
      for (const handler of exitHandlers) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);

      expect(spawnLocalPty).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not start a delayed local replacement after explicit stop', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
      spawnLocalPty.mockReturnValue(fakePty(exitHandlers));
      const provider = localProvider();
      const item = conversation();

      await provider.startSession(item);
      for (const handler of exitHandlers) handler({ exitCode: 0 });
      await provider.stopSession(item.id);
      await vi.advanceTimersByTimeAsync(500);

      expect(spawnLocalPty).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not replace a local tmux attachment after it exits', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
      spawnLocalPty.mockReturnValue(fakePty(exitHandlers));
      const provider = localProvider({ tmux: true });
      const item = conversation();

      await provider.startSession(item);
      vi.mocked(events.emit).mockClear();
      for (const handler of exitHandlers) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);

      expect(spawnLocalPty).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith(
        agentSessionExitedChannel,
        expect.objectContaining({
          conversationId: item.id,
          taskId: item.taskId,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not replace an SSH tmux attachment after it exits', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
      openSsh2Pty.mockResolvedValue({
        success: true,
        data: fakePty(exitHandlers),
      });
      const provider = sshProvider(undefined, { tmux: true });
      const item = conversation();

      await provider.startSession(item);
      vi.mocked(events.emit).mockClear();
      for (const handler of exitHandlers) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);

      expect(openSsh2Pty).toHaveBeenCalledTimes(1);
      expect(events.emit).toHaveBeenCalledWith(
        agentSessionExitedChannel,
        expect.objectContaining({
          conversationId: item.id,
          taskId: item.taskId,
        })
      );
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
        .mockResolvedValueOnce({
          success: true,
          data: fakePty(firstExitHandlers),
        })
        .mockResolvedValueOnce({
          success: true,
          data: fakePty(secondExitHandlers),
        });
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
      expect(events.emit).not.toHaveBeenCalledWith(agentSessionExitedChannel, expect.anything());

      for (const handler of secondExitHandlers) handler({ exitCode: 127 });
      await vi.advanceTimersByTimeAsync(500);

      expect(proxy.refreshRemoteShellProfile).toHaveBeenCalledTimes(1);
      expect(openSsh2Pty).toHaveBeenCalledTimes(2);
      expect(events.emit).toHaveBeenCalledWith(
        agentSessionExitedChannel,
        expect.objectContaining({
          conversationId: item.id,
          taskId: item.taskId,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets SSH supervisor state after a shell refresh retry also exits missing-command', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<Array<(info: PtyExitInfo) => void>> = [];
      openSsh2Pty.mockImplementation(() => {
        const handlers: Array<(info: PtyExitInfo) => void> = [];
        exitHandlers.push(handlers);
        return Promise.resolve({ success: true, data: fakePty(handlers) });
      });
      const proxy = {
        getRemoteShellProfile: vi.fn(async () => ({})),
        refreshRemoteShellProfile: vi.fn(async () => ({})),
      };
      const provider = sshProvider(proxy);
      const item = conversation();

      await provider.startSession(item, undefined, true);
      for (const handler of exitHandlers[0] ?? []) handler({ exitCode: 127 });
      await vi.advanceTimersByTimeAsync(500);
      for (const handler of exitHandlers[1] ?? []) handler({ exitCode: 127 });

      await provider.startSession(item);
      for (const handler of exitHandlers[2] ?? []) handler({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(500);

      expect(proxy.refreshRemoteShellProfile).toHaveBeenCalledTimes(1);
      expect(openSsh2Pty).toHaveBeenCalledTimes(4);
      expect(buildCommandMock.mock.calls.map(([args]) => args.isResuming)).toEqual([
        true,
        false,
        false,
        true,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not refresh the SSH shell profile after explicit stop cancels a missing-command retry', async () => {
    vi.useFakeTimers();
    try {
      const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
      openSsh2Pty.mockResolvedValue({
        success: true,
        data: fakePty(exitHandlers),
      });
      const proxy = {
        getRemoteShellProfile: vi.fn(async () => ({})),
        refreshRemoteShellProfile: vi.fn(async () => ({})),
      };
      const provider = sshProvider(proxy);
      const item = conversation();

      await provider.startSession(item);
      for (const handler of exitHandlers) handler({ exitCode: 127 });
      await provider.stopSession(item.id);
      await vi.advanceTimersByTimeAsync(500);

      expect(proxy.refreshRemoteShellProfile).not.toHaveBeenCalled();
      expect(openSsh2Pty).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detaches local tmux conversations without killing the tmux session', async () => {
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    const pty = fakePty(exitHandlers);
    spawnLocalPty.mockReturnValue(pty);
    const ctx = {
      exec: vi.fn(async () => ({ stdout: '', stderr: '' })),
    };
    const provider = localProvider({ tmux: true, ctx: ctx as never });
    const item = conversation();
    const sessionId = makePtySessionId(item.projectId, item.taskId, item.id);

    await provider.startSession(item);
    vi.mocked(events.emit).mockClear();
    await provider.detachSession(item.id);
    for (const handler of exitHandlers) handler({ exitCode: 0 });

    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(ctx.exec).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalledWith(agentSessionExitedChannel, expect.anything());
    expect((provider as unknown as RespawnState).knownSessionIds.has(sessionId)).toBe(true);
  });

  it('detaches SSH tmux conversations without killing the tmux session', async () => {
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    const pty = fakePty(exitHandlers);
    openSsh2Pty.mockResolvedValue({ success: true, data: pty });
    const ctx = {
      exec: vi.fn(async () => ({ stdout: '', stderr: '' })),
    };
    const provider = sshProvider(undefined, { tmux: true, ctx: ctx as never });
    const item = conversation();
    const sessionId = makePtySessionId(item.projectId, item.taskId, item.id);

    await provider.startSession(item);
    vi.mocked(events.emit).mockClear();
    await provider.detachSession(item.id);
    for (const handler of exitHandlers) handler({ exitCode: 0 });

    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(ctx.exec).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalledWith(agentSessionExitedChannel, expect.anything());
    expect((provider as unknown as RespawnState).knownSessionIds.has(sessionId)).toBe(true);
  });

  it('kills tmux when explicitly stopping a detached local conversation', async () => {
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    spawnLocalPty.mockReturnValue(fakePty(exitHandlers));
    const ctx = {
      exec: vi.fn(async () => ({ stdout: '', stderr: '' })),
    };
    const provider = localProvider({ tmux: true, ctx: ctx as never });
    const item = conversation();
    const sessionId = makePtySessionId(item.projectId, item.taskId, item.id);

    await provider.startSession(item);
    await provider.detachSession(item.id);
    await provider.stopSession(item.id);

    expect(ctx.exec).toHaveBeenCalledWith('tmux', [
      'kill-session',
      '-t',
      expect.stringContaining(Buffer.from(sessionId, 'utf8').toString('base64url')),
    ]);
    expect((provider as unknown as RespawnState).knownSessionIds.has(sessionId)).toBe(false);
  });

  it('kills tmux when explicitly stopping a detached SSH conversation', async () => {
    const exitHandlers: Array<(info: PtyExitInfo) => void> = [];
    openSsh2Pty.mockResolvedValue({
      success: true,
      data: fakePty(exitHandlers),
    });
    const ctx = {
      exec: vi.fn(async () => ({ stdout: '', stderr: '' })),
    };
    const provider = sshProvider(undefined, { tmux: true, ctx: ctx as never });
    const item = conversation();
    const sessionId = makePtySessionId(item.projectId, item.taskId, item.id);

    await provider.startSession(item);
    await provider.detachSession(item.id);
    await provider.stopSession(item.id);

    expect(ctx.exec).toHaveBeenCalledWith('tmux', [
      'kill-session',
      '-t',
      expect.stringContaining(Buffer.from(sessionId, 'utf8').toString('base64url')),
    ]);
    expect((provider as unknown as RespawnState).knownSessionIds.has(sessionId)).toBe(false);
  });

  it('ignores stale local attach exits after a tmux conversation is rehydrated', async () => {
    const firstExitHandlers: Array<(info: PtyExitInfo) => void> = [];
    const secondExitHandlers: Array<(info: PtyExitInfo) => void> = [];
    const firstPty = fakePty(firstExitHandlers);
    const secondPty = fakePty(secondExitHandlers);
    spawnLocalPty.mockReturnValueOnce(firstPty).mockReturnValueOnce(secondPty);
    const provider = localProvider({ tmux: true });
    const item = conversation();
    const sessionId = makePtySessionId(item.projectId, item.taskId, item.id);

    await provider.startSession(item);
    await provider.detachSession(item.id);
    await provider.startSession(item);
    vi.mocked(events.emit).mockClear();
    for (const handler of firstExitHandlers) handler({ exitCode: 0 });

    expect((provider as unknown as RespawnState).sessions.get(sessionId)).toBe(secondPty);
    expect(events.emit).not.toHaveBeenCalledWith(agentSessionExitedChannel, expect.anything());
  });

  it('ignores stale SSH attach exits after a tmux conversation is rehydrated', async () => {
    const firstExitHandlers: Array<(info: PtyExitInfo) => void> = [];
    const secondExitHandlers: Array<(info: PtyExitInfo) => void> = [];
    const firstPty = fakePty(firstExitHandlers);
    const secondPty = fakePty(secondExitHandlers);
    openSsh2Pty
      .mockResolvedValueOnce({ success: true, data: firstPty })
      .mockResolvedValueOnce({ success: true, data: secondPty });
    const provider = sshProvider(undefined, { tmux: true });
    const item = conversation();
    const sessionId = makePtySessionId(item.projectId, item.taskId, item.id);

    await provider.startSession(item);
    await provider.detachSession(item.id);
    await provider.startSession(item);
    vi.mocked(events.emit).mockClear();
    for (const handler of firstExitHandlers) handler({ exitCode: 0 });

    expect((provider as unknown as RespawnState).sessions.get(sessionId)).toBe(secondPty);
    expect(events.emit).not.toHaveBeenCalledWith(agentSessionExitedChannel, expect.anything());
  });
});
