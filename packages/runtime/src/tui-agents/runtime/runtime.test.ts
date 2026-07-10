import {
  AgentPluginHost,
  createPluginRegistry,
  type AgentCommand,
  type CLIAgentPluginProvider,
  type CommandContext,
} from '@emdash/core/agents/plugins';
import type { PtyExitInfo, PtyProcess, PtySpawner, PtySpawnSpec } from '@emdash/core/pty';
import {
  tuiAgentsContract,
  tuiNotificationListSchema,
  tuiSessionListSchema,
} from '@emdash/core/workspace-server';
import { ok } from '@emdash/shared';
import { ReplicaState } from '@emdash/wire';
import { createStubLogger, createTestWire, waitFor } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTuiAgentsController } from '../api/controller';
import { TuiAgentsRuntime } from './runtime';
import type { TuiAgentsRuntimeDeps } from './types';

describe('TuiAgentsRuntime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps sessions alive while output is attached and disposes after grace', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const wire = createTestWire(tuiAgentsContract, createTuiAgentsController(harness.runtime));
    const key = { conversationId: 'conv-1' };

    try {
      expect(await wire.client.startSession({ input: startInput(key.conversationId) })).toEqual({
        success: true,
        data: undefined,
      });

      const firstDetach = await wire.client.output.handle(key).attach(() => {});
      await vi.waitFor(() => {
        expect(harness.spawner.processes).toHaveLength(1);
      });
      const secondDetach = await wire.client.output.handle(key).attach(() => {});
      expect(harness.spawner.processes).toHaveLength(1);

      firstDetach();
      secondDetach();
      await vi.advanceTimersByTimeAsync(2_999);
      expect(harness.spawner.processes[0]!.killed).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      expect(harness.spawner.processes[0]!.killed).toBe(true);
    } finally {
      wire.dispose();
      harness.runtime.dispose();
    }
  });

  it('serves retained output without spawning when stopped', async () => {
    const harness = createHarness();
    const wire = createTestWire(tuiAgentsContract, createTuiAgentsController(harness.runtime));
    const key = { conversationId: 'conv-retained' };

    try {
      await wire.client.startSession({ input: startInput(key.conversationId) });
      const detach = await wire.client.output.handle(key).attach(() => {});
      await waitFor(() => harness.spawner.processes.length === 1);
      harness.spawner.processes[0]!.emitData('hello\n');
      await waitFor(
        async () => (await wire.client.output.handle(key).snapshot()).data.text === 'hello\n'
      );

      expect(await wire.client.stopSession(key)).toEqual({ success: true, data: undefined });
      detach();

      const snapshot = await wire.client.output.handle(key).snapshot();
      expect(snapshot.data.text).toBe('hello\n');
      expect(harness.spawner.processes).toHaveLength(1);

      expect(await wire.client.deleteSession(key)).toEqual({ success: true, data: undefined });
      expect((await wire.client.output.handle(key).snapshot()).data.text).toBe('');
    } finally {
      wire.dispose();
      harness.runtime.dispose();
    }
  });

  it('uses the start config as managed-source creation context', async () => {
    const harness = createHarness();
    const wire = createTestWire(tuiAgentsContract, createTuiAgentsController(harness.runtime));
    const key = { conversationId: 'conv-context' };

    try {
      await wire.client.startSession({
        input: startInput(key.conversationId, {
          cwd: '/tmp/context-project',
          cols: 100,
          rows: 40,
          providerVars: { PROVIDER_VAR: '1' },
        }),
      });

      const detach = await wire.client.output.handle(key).attach(() => {});
      await waitFor(() => harness.spawner.processes.length === 1);

      expect(harness.spawner.processes[0]?.spec).toMatchObject({
        command: 'agent',
        args: ['start'],
        cwd: '/tmp/context-project',
        cols: 100,
        rows: 40,
        env: expect.objectContaining({
          BASE_ENV: '1',
          COMMAND_ENV: '1',
          PROVIDER_VAR: '1',
        }),
      });
      detach();
    } finally {
      wire.dispose();
      harness.runtime.dispose();
    }
  });

  it('publishes hook session ids and notification states', async () => {
    const harness = createHarness();
    const wire = createTestWire(tuiAgentsContract, createTuiAgentsController(harness.runtime));
    const sessions = new ReplicaState(wire.client.sessions.state(undefined, 'list'), {
      schema: tuiSessionListSchema,
    });
    const notifications = new ReplicaState(wire.client.notifications.state(undefined, 'list'), {
      schema: tuiNotificationListSchema,
    });

    try {
      await Promise.all([sessions.ready, notifications.ready]);
      await wire.client.startSession({ input: startInput('conv-hooks') });
      const detach = await wire.client.output
        .handle({ conversationId: 'conv-hooks' })
        .attach(() => {});
      await waitFor(() => sessions.current()['conv-hooks']?.status === 'running');

      await wire.client.emitHookEvent({
        conversationId: 'conv-hooks',
        eventType: 'session',
        body: { session_id: 'provider-session-1' },
      });
      await waitFor(() => sessions.current()['conv-hooks']?.sessionId === 'provider-session-1');

      await wire.client.emitHookEvent({
        conversationId: 'conv-hooks',
        eventType: 'notification',
        body: { notification_type: 'permission_prompt', message: 'approve?' },
      });
      await waitFor(() => notifications.current()['conv-hooks']?.status === 'awaiting-input');
      expect(notifications.current()['conv-hooks']).toMatchObject({
        notificationType: 'permission_prompt',
        message: 'approve?',
      });

      detach();
    } finally {
      await sessions.dispose();
      await notifications.dispose();
      wire.dispose();
      harness.runtime.dispose();
    }
  });

  it('falls back to fresh state when resuming without a provider session id', async () => {
    const harness = createHarness();
    const wire = createTestWire(tuiAgentsContract, createTuiAgentsController(harness.runtime));
    const sessions = new ReplicaState(wire.client.sessions.state(undefined, 'list'), {
      schema: tuiSessionListSchema,
    });

    try {
      await sessions.ready;
      const result = await wire.client.resumeSession({
        input: startInput('conv-resume', { sessionId: null }),
      });
      expect(result).toEqual({ success: true, data: { outcome: 'fresh-fallback' } });

      const detach = await wire.client.output
        .handle({ conversationId: 'conv-resume' })
        .attach(() => {});
      await waitFor(() => sessions.current()['conv-resume']?.status === 'running');
      expect(sessions.current()['conv-resume']?.resume).toMatchObject({
        requested: true,
        outcome: 'fresh-fallback',
      });
      detach();
    } finally {
      await sessions.dispose();
      wire.dispose();
      harness.runtime.dispose();
    }
  });

  it('injects keystroke-delivered initial prompts after output idles', async () => {
    vi.useFakeTimers();
    const harness = createHarness({ prompt: { kind: 'keystroke', submitSequence: '\r' } });
    const wire = createTestWire(tuiAgentsContract, createTuiAgentsController(harness.runtime));

    try {
      await wire.client.startSession({
        input: startInput('conv-keystroke', { initialPrompt: 'hello agent' }),
      });
      const detach = await wire.client.output
        .handle({ conversationId: 'conv-keystroke' })
        .attach(() => {});
      await vi.waitFor(() => {
        expect(harness.spawner.processes).toHaveLength(1);
      });
      const proc = harness.spawner.processes[0]!;

      proc.emitData('ready');
      await vi.advanceTimersByTimeAsync(800);
      expect(proc.writes).toEqual(['hello agent\r']);

      detach();
    } finally {
      wire.dispose();
      harness.runtime.dispose();
    }
  });
});

function createHarness(
  overrides: {
    prompt?: CLIAgentPluginProvider['capabilities']['prompt'];
  } = {}
): {
  runtime: TuiAgentsRuntime;
  spawner: FakePtySpawner;
} {
  const spawner = new FakePtySpawner();
  const registry = createPluginRegistry<CLIAgentPluginProvider>();
  registry.register(plugin(overrides));
  const { logger } = createStubLogger();
  const deps: TuiAgentsRuntimeDeps = {
    pluginHost: new AgentPluginHost(registry),
    spawner,
    spawnContext: {
      resolve: async () => ok({ cli: 'agent', agentEnv: { BASE_ENV: '1' } }),
      invalidate: () => {},
    },
    logger,
  };
  return { runtime: new TuiAgentsRuntime(deps), spawner };
}

function startInput(
  conversationId: string,
  overrides: Partial<Parameters<TuiAgentsRuntime['startSession']>[0]> = {}
): Parameters<TuiAgentsRuntime['startSession']>[0] {
  return {
    conversationId,
    providerId: 'test',
    cwd: '/tmp/project',
    sessionId: 'provider-session',
    model: 'model',
    initialPrompt: 'initial prompt',
    autoApprove: false,
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

function plugin(
  overrides: {
    prompt?: CLIAgentPluginProvider['capabilities']['prompt'];
  } = {}
): CLIAgentPluginProvider {
  return {
    metadata: {
      id: 'test',
      name: 'Test Agent',
      description: 'Test agent',
      websiteUrl: 'https://example.com',
    },
    capabilities: {
      acp: { kind: 'none' },
      auth: { kind: 'none' },
      prompt: overrides.prompt ?? { kind: 'argv' },
      hooks: { kind: 'none' },
    },
    behavior: {
      prompt: {
        buildCommand: (ctx: CommandContext): AgentCommand => ({
          command: ctx.cli,
          args: ctx.isResuming ? ['resume', ctx.providerSessionId ?? ''] : ['start'],
          env: { COMMAND_ENV: '1' },
        }),
      },
    },
  } as unknown as CLIAgentPluginProvider;
}

class FakePtySpawner implements PtySpawner {
  readonly processes: FakePtyProcess[] = [];

  spawn(spec: PtySpawnSpec): PtyProcess {
    const proc = new FakePtyProcess(spec);
    this.processes.push(proc);
    return proc;
  }
}

class FakePtyProcess implements PtyProcess {
  readonly writes: string[] = [];
  killed = false;
  private readonly dataHandlers: Array<(data: string) => void> = [];
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];

  constructor(readonly spec: PtySpawnSpec) {}

  write(data: string): void {
    this.writes.push(data);
  }

  resize(cols: number, rows: number): void {
    this.spec.cols = cols;
    this.spec.rows = rows;
  }

  kill(): void {
    this.killed = true;
  }

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  getPid(): number {
    return 123;
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  emitExit(info: PtyExitInfo = { exitCode: 0, signal: null }): void {
    for (const handler of this.exitHandlers) handler(info);
  }
}
