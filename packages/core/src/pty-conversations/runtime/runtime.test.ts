import { ok } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import {
  createPluginRegistry,
  definePlugin,
  registerPluginBehavior,
  type CLIAgentPluginProvider,
} from '../../agents/plugins';
import type { AgentCommand, CommandContext } from '../../agents/plugins/capabilities/prompt';
import type { PtyAgentStartInput } from '../api/schemas';
import type { PtyExitInfo, PtyHandle, PtySpawnSpec } from '../transport';
import { PtyConversationsRuntime } from './runtime';
import type { PersistPtySessionId } from './types';

const icon = {
  kind: 'svg' as const,
  variants: [{ minSize: 0, light: '<svg />' }],
};

function startInput(overrides: Partial<PtyAgentStartInput> = {}): PtyAgentStartInput {
  return {
    conversationId: 'conversation-1',
    providerId: 'fake',
    cwd: '/repo',
    sessionId: null,
    model: 'model-1',
    resume: false,
    initialPrompt: 'hello',
    autoApprove: true,
    extraArgs: ['--extra'],
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

class ScriptedPtyHandle implements PtyHandle {
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();
  private readonly dataHandlers: ((data: string) => void)[] = [];
  private readonly exitHandlers: ((info: PtyExitInfo) => void)[] = [];

  constructor(private readonly pid: number) {}

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  getPid(): number {
    return this.pid;
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  exit(info: PtyExitInfo = { exitCode: 0 }): void {
    for (const handler of this.exitHandlers) handler(info);
  }
}

function makePlugin(args: {
  providerId?: string;
  promptKind?: 'argv' | 'keystroke';
  sessionsKind?: 'resumable' | 'stateless';
  requiresProviderSessionId?: boolean;
  buildCommand?: (ctx: CommandContext) => AgentCommand;
} = {}): CLIAgentPluginProvider {
  const providerId = args.providerId ?? 'fake';
  const plugin = definePlugin(
    {
      id: providerId,
      name: providerId,
      description: 'Fake test provider',
      websiteUrl: 'https://example.invalid',
    },
    {
      hostDependency: {
        id: providerId,
        binaryNames: [`${providerId}-cli`],
        installCommands: { macos: [], linux: [], windows: [] },
        updates: { kind: 'none' },
      },
      prompt:
        args.promptKind === 'keystroke'
          ? { kind: 'keystroke' }
          : { kind: 'argv', flag: '' },
      sessions: {
        kind: args.sessionsKind ?? 'resumable',
        ...(args.requiresProviderSessionId ? { requiresProviderSessionId: true } : {}),
      },
    },
    { icon }
  );

  return registerPluginBehavior(plugin, {
    prompt: {
      buildCommand:
        args.buildCommand ??
        ((ctx) => ({
          command: ctx.cli,
          args: [
            ...(ctx.isResuming ? ['resume'] : ['new']),
            ...(ctx.initialPrompt ? [ctx.initialPrompt] : []),
            ...(ctx.extraArgs ?? []),
          ],
          env: { AGENT_ENV: '1' },
        })),
    },
  });
}

function makeRuntime(options: {
  plugin?: CLIAgentPluginProvider;
  spawnPty?: (spec: PtySpawnSpec) => PtyHandle;
  resolveCliPath?: (binaryName: string) => string | null;
  respawnDelayMs?: number;
  persistSessionId?: PersistPtySessionId;
} = {}) {
  const registry = createPluginRegistry<CLIAgentPluginProvider>();
  registry.register(options.plugin ?? makePlugin());
  const handles: ScriptedPtyHandle[] = [];
  const spawnSpecs: PtySpawnSpec[] = [];
  const spawnPty = vi.fn((spec: PtySpawnSpec) => {
    spawnSpecs.push(spec);
    if (options.spawnPty) return options.spawnPty(spec);
    const handle = new ScriptedPtyHandle(1000 + handles.length);
    handles.push(handle);
    return handle;
  });
  const persistSessionId =
    options.persistSessionId ??
    vi.fn(async (_conversationId: string, _sessionId: string) => ok(undefined));
  const runtime = new PtyConversationsRuntime({
    plugins: registry,
    buildEnv: async (_providerId, agentEnv) => ({ PATH: '/bin', ...agentEnv }),
    resolveCliPath: async (binaryName) =>
      options.resolveCliPath ? options.resolveCliPath(binaryName) : `/usr/bin/${binaryName}`,
    spawnPty,
    persistSessionId,
    logger: noopLogger,
    respawnDelayMs: options.respawnDelayMs ?? 0,
  });

  return { runtime, handles, spawnSpecs, spawnPty, persistSessionId };
}

describe('PtyConversationsRuntime', () => {
  it('starts a session from plugin command data and publishes running session state', async () => {
    const buildCommand = vi.fn((ctx: CommandContext) => ({
      command: ctx.cli,
      args: [ctx.model, String(ctx.autoApprove), ctx.initialPrompt ?? '', ...(ctx.extraArgs ?? [])],
      env: { FROM_PLUGIN: '1' },
    }));
    const { runtime, spawnSpecs, persistSessionId } = makeRuntime({
      plugin: makePlugin({ buildCommand }),
    });

    const result = await runtime.startSession(startInput());

    expect(result).toEqual({ success: true, data: { sessionId: 'conversation-1' } });
    expect(buildCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cli: '/usr/bin/fake-cli',
        initialPrompt: 'hello',
        sessionId: 'conversation-1',
        isResuming: false,
        model: 'model-1',
      })
    );
    expect(spawnSpecs[0]).toEqual({
      id: 'conversation-1',
      command: '/usr/bin/fake-cli',
      args: ['model-1', 'true', 'hello', '--extra'],
      cwd: '/repo',
      env: { PATH: '/bin', FROM_PLUGIN: '1' },
      cols: 80,
      rows: 24,
    });
    expect(persistSessionId).toHaveBeenCalledWith('conversation-1', 'conversation-1');
    expect(runtime.sessionsLiveModel().snapshot().data['conversation-1']).toEqual(
      expect.objectContaining({
        conversationId: 'conversation-1',
        providerId: 'fake',
        status: 'running',
        pid: 1000,
        cols: 80,
        rows: 24,
      })
    );
  });

  it('coalesces PTY output into the LiveLog snapshot', async () => {
    vi.useFakeTimers();
    try {
      const { runtime, handles } = makeRuntime();
      await runtime.startSession(startInput());

      handles[0].emitData('one');
      handles[0].emitData(' two');
      await vi.advanceTimersByTimeAsync(16);

      expect(runtime.outputLog('conversation-1')?.snapshot().data).toEqual({
        baseOffset: 0,
        text: 'one two',
        truncated: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('routes input and resize, and reports not-found for unknown sessions', async () => {
    const { runtime, handles } = makeRuntime();
    await runtime.startSession(startInput());

    expect(runtime.sendInput('conversation-1', 'abc')).toEqual({ success: true, data: undefined });
    expect(runtime.resize('conversation-1', 100, 40)).toEqual({ success: true, data: undefined });
    expect(handles[0].write).toHaveBeenCalledWith('abc');
    expect(handles[0].resize).toHaveBeenCalledWith(100, 40);
    expect(runtime.sendInput('missing', 'abc')).toEqual({
      success: false,
      error: { type: 'not-found', conversationId: 'missing' },
    });
  });

  it('returns typed errors for unknown providers and missing commands', async () => {
    const { runtime } = makeRuntime({
      resolveCliPath: () => null,
    });

    await expect(runtime.startSession(startInput({ providerId: 'missing' }))).resolves.toEqual({
      success: false,
      error: { type: 'unknown-provider', providerId: 'missing' },
    });
    await expect(runtime.startSession(startInput())).resolves.toEqual({
      success: false,
      error: { type: 'no-command', providerId: 'fake' },
    });

  });

  it('returns alreadyRunning for idempotent double starts', async () => {
    const { runtime } = makeRuntime();
    await runtime.startSession(startInput());

    await expect(runtime.startSession(startInput())).resolves.toEqual({
      success: true,
      data: { sessionId: 'conversation-1', alreadyRunning: true },
    });
  });

  it('respawns resume, then fresh after a resume exit', async () => {
    vi.useFakeTimers();
    try {
      const buildCommand = vi.fn((ctx: CommandContext) => ({
        command: ctx.cli,
        args: [ctx.isResuming ? 'resume' : 'fresh'],
        env: {},
      }));
      const { runtime, handles, spawnPty } = makeRuntime({
        plugin: makePlugin({ buildCommand }),
        respawnDelayMs: 0,
      });
      await runtime.startSession(startInput());

      handles[0].exit({ exitCode: 1 });
      expect(runtime.sessionsLiveModel().snapshot().data['conversation-1']).toEqual(
        expect.objectContaining({
          status: 'restarting',
          exit: { exitCode: 1 },
        })
      );
      await vi.runOnlyPendingTimersAsync();
      expect(spawnPty).toHaveBeenCalledTimes(2);
      expect(buildCommand).toHaveBeenLastCalledWith(expect.objectContaining({ isResuming: true }));

      handles[1].exit({ exitCode: 1 });
      await vi.runOnlyPendingTimersAsync();
      expect(spawnPty).toHaveBeenCalledTimes(3);
      expect(buildCommand).toHaveBeenLastCalledWith(expect.objectContaining({ isResuming: false }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('respawns with the latest resized dimensions', async () => {
    vi.useFakeTimers();
    try {
      const { runtime, handles, spawnSpecs } = makeRuntime({ respawnDelayMs: 0 });
      await runtime.startSession(startInput());
      runtime.resize('conversation-1', 100, 40);

      handles[0].exit({ exitCode: 1 });
      await vi.runOnlyPendingTimersAsync();

      expect(spawnSpecs[1]).toEqual(expect.objectContaining({ cols: 100, rows: 40 }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop retains output and exited state; dispose removes them', async () => {
    vi.useFakeTimers();
    try {
      const { runtime, handles, spawnPty } = makeRuntime({ respawnDelayMs: 0 });
      await runtime.startSession(startInput());
      handles[0].emitData('retained');
      await vi.advanceTimersByTimeAsync(16);

      expect(runtime.stopSession('conversation-1')).toEqual({ success: true, data: undefined });
      expect(handles[0].kill).toHaveBeenCalled();
      handles[0].exit({ exitCode: 0 });
      await vi.runOnlyPendingTimersAsync();

      expect(spawnPty).toHaveBeenCalledTimes(1);
      expect(runtime.outputLog('conversation-1')?.snapshot().data.text).toBe('retained');
      expect(runtime.sessionsLiveModel().snapshot().data['conversation-1']).toEqual(
        expect.objectContaining({
          status: 'exited',
          exit: { exitCode: null },
        })
      );
      expect(runtime.disposeSession('conversation-1')).toEqual({ success: true, data: undefined });
      expect(runtime.sessionsLiveModel().snapshot().data).toEqual({});
      expect(runtime.outputLog('conversation-1')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('injects the initial prompt for keystroke prompt-delivery providers', async () => {
    vi.useFakeTimers();
    try {
      const { runtime, handles } = makeRuntime({
        plugin: makePlugin({ promptKind: 'keystroke' }),
      });
      await runtime.startSession(startInput({ initialPrompt: 'line one\nline two' }));

      handles[0].emitData('ready');
      await vi.advanceTimersByTimeAsync(800);

      expect(handles[0].write).toHaveBeenCalledWith('\x1b[200~line one\nline two\x1b[201~\r');
    } finally {
      vi.useRealTimers();
    }
  });
});
