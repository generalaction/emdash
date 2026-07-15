import { ok } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { createManualClock, type ManualClock } from '@emdash/shared/testing';
import type { TuiAgentStartInput } from '@runtimes/tui-agents/api';
import type { AgentPluginHost, ResolvedTuiProvider } from '@services/agent-plugins/api/plugins';
import type { IExecutionContext } from '@services/exec/api';
import type { PtyExitInfo, PtyProcess, PtySpawnSpec, PtySpawner } from '@services/pty/api';
import { createMemorySessionIntentStore } from '@services/session-intents/api';
import { describe, expect, it, vi } from 'vitest';
import { TuiAgentsRuntime } from './runtime';

class FakePtyProcess implements PtyProcess {
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();
  private readonly dataHandlers: Array<(data: string) => void> = [];
  private readonly exitHandlers: Array<(info: PtyExitInfo) => void> = [];

  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  emitExit(info: PtyExitInfo): void {
    for (const handler of this.exitHandlers) handler(info);
  }

  getPid(): number {
    return 1234;
  }
}

class FakePtySpawner implements PtySpawner {
  readonly specs: PtySpawnSpec[] = [];
  readonly processes: FakePtyProcess[] = [];

  spawn(spec: PtySpawnSpec): PtyProcess {
    this.specs.push(spec);
    const process = new FakePtyProcess();
    this.processes.push(process);
    return process;
  }
}

function createRuntime(
  options: {
    clock?: ManualClock;
    lifecycle?: ConstructorParameters<typeof TuiAgentsRuntime>[0]['lifecycle'];
    exec?: Partial<IExecutionContext>;
    intents?: ReturnType<typeof createMemorySessionIntentStore>;
  } = {}
) {
  const spawner = new FakePtySpawner();
  const provider: ResolvedTuiProvider = {
    name: 'Test Agent',
    prompt: { kind: 'argv' },
    hooks: { kind: 'none' },
    buildCommand: () => ({ command: 'agent', args: ['run'], env: {} }),
  };
  const agentHost = {
    resolveTuiProvider: vi.fn(() => provider),
    get: vi.fn(() => ({ id: 'test' })),
    buildPromptCommand: vi.fn(() =>
      Promise.resolve(ok({ command: 'agent', args: ['run', 'hello world'], env: { AGENT: '1' } }))
    ),
  } as unknown as AgentPluginHost;
  const exec = {
    root: '',
    supportsLocalSpawn: true,
    exec: vi.fn(() => Promise.resolve({ stdout: '', stderr: '' })),
    execStreaming: vi.fn(() => Promise.resolve()),
    dispose: vi.fn(),
    ...options.exec,
  } satisfies IExecutionContext;
  const runtime = new TuiAgentsRuntime({
    agentHost,
    exec,
    intents: options.intents ?? createMemorySessionIntentStore(),
    spawner,
    clock: options.clock,
    lifecycle: options.lifecycle,
    logger: noopLogger,
  });
  return { runtime, spawner, agentHost, exec };
}

function startInput(overrides: Partial<TuiAgentStartInput> = {}): TuiAgentStartInput {
  return {
    conversationId: 'conversation-1',
    providerId: 'test',
    cwd: '/workspace',
    sessionId: null,
    model: null,
    initialPrompt: 'hello',
    cols: 120,
    rows: 30,
    ...overrides,
  };
}

describe('TuiAgentsRuntime', () => {
  it('registers intent and spawns when output is attached', async () => {
    const { runtime, spawner } = createRuntime();

    expect(runtime.startSession(startInput()).success).toBe(true);
    expect(spawner.specs).toHaveLength(0);

    await runtime.outputLog({ conversationId: 'conversation-1' }).snapshot();

    expect(spawner.specs).toEqual([
      {
        command: 'agent',
        args: ['run', 'hello world'],
        cwd: '/workspace',
        env: {
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          TERM_PROGRAM: 'emdash',
          AGENT: '1',
        },
        cols: 120,
        rows: 30,
      },
    ]);
  });

  it('wraps command execution with shellSetup and tmux', async () => {
    const { runtime, spawner } = createRuntime();

    runtime.startSession(
      startInput({
        shellSetup: 'source ~/.profile',
        tmuxSessionName: 'emdash-test',
      })
    );
    await runtime.outputLog({ conversationId: 'conversation-1' }).snapshot();

    expect(spawner.specs[0]!.command).toBe('/bin/sh');
    expect(spawner.specs[0]!.args[0]).toBe('-c');
    expect(spawner.specs[0]!.args[1]).toContain('tmux -u attach-session');
    expect(spawner.specs[0]!.args[1]).toContain('emdash-test');
    expect(spawner.specs[0]!.args[1]).toContain("source ~/.profile && agent run 'hello world'");
  });

  it('stops and deletes sessions while cleaning up tmux', async () => {
    const { runtime, spawner, exec } = createRuntime();

    runtime.startSession(startInput({ tmuxSessionName: 'emdash-test' }));
    await runtime.outputLog({ conversationId: 'conversation-1' }).snapshot();
    runtime.stopSession('conversation-1');

    expect(spawner.processes[0]!.kill).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(exec.exec).toHaveBeenCalledWith('tmux', ['kill-session', '-t', 'emdash-test']);
    });

    runtime.startSession(startInput({ tmuxSessionName: 'emdash-test' }));
    await runtime.outputLog({ conversationId: 'conversation-1' }).snapshot();
    runtime.deleteSession('conversation-1');

    await vi.waitFor(() => {
      expect(exec.exec).toHaveBeenCalledTimes(2);
    });
  });

  it('falls back to a fresh session when resume exits immediately', async () => {
    const { runtime, spawner, agentHost } = createRuntime();

    const result = runtime.resumeSession(startInput({ sessionId: 'provider-session' }));
    expect(result).toEqual(ok({ outcome: 'resumed' }));
    await runtime.outputLog({ conversationId: 'conversation-1' }).snapshot();

    spawner.processes[0]!.emitExit({ exitCode: 0, signal: null });

    await vi.waitFor(() => {
      expect(spawner.specs).toHaveLength(2);
    });
    expect(agentHost.buildPromptCommand).toHaveBeenNthCalledWith(
      1,
      'test',
      expect.objectContaining({ isResuming: true, initialPrompt: undefined })
    );
    expect(agentHost.buildPromptCommand).toHaveBeenNthCalledWith(
      2,
      'test',
      expect.objectContaining({ isResuming: false, initialPrompt: 'hello' })
    );
  });

  it('deactivates idle sessions after the configured output inactivity period', async () => {
    const clock = createManualClock(0);
    const { runtime } = createRuntime({
      clock,
      lifecycle: { session: { kind: 'idle-after', outputMs: 1_000 }, sweepIntervalMs: 1_100 },
    });

    runtime.startSession(startInput());
    await runtime.outputLog({ conversationId: 'conversation-1' }).snapshot();

    await clock.advanceBy(1_200);

    expect(runtime.sessionsLiveHost().get(undefined)?.states.list.snapshot().data).toEqual({});
  });

  it('uses batched tmux activity to keep detached tmux sessions active', async () => {
    const clock = createManualClock(1_000_000);
    const exec = vi.fn(() =>
      Promise.resolve({
        stdout: `emdash-test\t${Math.floor(clock.now() / 1000)}\n`,
        stderr: '',
      })
    );
    const { runtime, spawner } = createRuntime({
      clock,
      lifecycle: { session: { kind: 'idle-after', outputMs: 1_000 }, sweepIntervalMs: 1_100 },
      exec: { exec },
    });

    runtime.startSession(startInput({ tmuxSessionName: 'emdash-test' }));
    await runtime.outputLog({ conversationId: 'conversation-1' }).snapshot();

    await clock.advanceBy(1_200);

    expect(exec).toHaveBeenCalledWith('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_activity}',
    ]);
    expect(spawner.processes[0]!.kill).not.toHaveBeenCalled();
    expect(runtime.sessionsLiveHost().get(undefined)?.states.list.snapshot().data).toHaveProperty(
      'conversation-1'
    );
  });

  it('reconciles active intents only when their tmux session exists', async () => {
    const intents = createMemorySessionIntentStore();
    await intents.saveActive({
      conversationId: 'conversation-1',
      sessionId: 'provider-session',
      payload: startInput({
        sessionId: 'provider-session',
        tmuxSessionName: 'emdash-test',
      }),
    });
    const exec = vi.fn(() =>
      Promise.resolve({
        stdout: 'emdash-test\t42\n',
        stderr: '',
      })
    );
    const { runtime, spawner } = createRuntime({
      intents,
      exec: { exec },
    });

    await runtime.reconcile();

    expect(spawner.specs).toHaveLength(0);
    expect(runtime.sessionsLiveHost().get(undefined)?.states.list.snapshot().data).toHaveProperty(
      'conversation-1'
    );
  });

  it('suspends active intents when their tmux session is missing', async () => {
    const intents = createMemorySessionIntentStore();
    await intents.saveActive({
      conversationId: 'conversation-1',
      payload: startInput({ tmuxSessionName: 'emdash-missing' }),
    });
    const { runtime } = createRuntime({ intents });

    await runtime.reconcile();

    expect(intents.snapshot()[0]).toMatchObject({
      conversationId: 'conversation-1',
      status: 'suspended',
      suspendedCause: 'process-lost',
    });
  });

  it('removes persisted TUI intent when a session is killed', async () => {
    const intents = createMemorySessionIntentStore();
    const { runtime, spawner } = createRuntime({ intents });

    runtime.startSession(startInput({ tmuxSessionName: 'emdash-test' }));
    await runtime.outputLog({ conversationId: 'conversation-1' }).snapshot();
    await vi.waitFor(() => expect(intents.snapshot()).toHaveLength(1));

    runtime.killSession('conversation-1');

    expect(spawner.processes[0]!.kill).toHaveBeenCalled();
    await vi.waitFor(() => expect(intents.snapshot()).toEqual([]));
  });
});
