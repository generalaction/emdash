import { ok } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { createManualClock, type ManualClock } from '@emdash/shared/testing';
import { peek } from '@emdash/wire/state';
import type { TuiAgentStartInput } from '@runtimes/tui-agents/api';
import type {
  AgentPluginHost,
  ITrustBehavior,
  ResolvedTuiProvider,
} from '@services/agent-plugins/api/plugins';
import type { ConversationLifecycleReporter } from '@services/conversation-reports/node';
import { createRecordingConversationLifecycleReporter } from '@services/conversation-reports/node/testing';
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
  failWith: Error | null = null;

  spawn(spec: PtySpawnSpec): PtyProcess {
    if (this.failWith) throw this.failWith;
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
    conversationReports?: ConversationLifecycleReporter;
    trustWorkspace?: ITrustBehavior['trustWorkspace'];
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
    homeDir: '/home/test-user',
    resolveTuiProvider: vi.fn(() => provider),
    get: vi.fn(() => ({
      capabilities: { hooks: { kind: 'none' } },
      behavior: options.trustWorkspace ? { trust: { trustWorkspace: options.trustWorkspace } } : {},
    })),
    buildPromptCommand: vi.fn(() =>
      Promise.resolve(ok({ command: 'agent', args: ['run', 'hello world'], env: { AGENT: '1' } }))
    ),
  } as unknown as AgentPluginHost;
  const exec = {
    root: '',
    supportsLocalSpawn: true,
    exec: vi.fn(() => Promise.resolve({ stdout: '', stderr: '' })),
    execStreaming: vi.fn(() => Promise.resolve({ exitCode: 0 })),
    dispose: vi.fn(),
    ...options.exec,
  } satisfies IExecutionContext;
  const runtime = new TuiAgentsRuntime({
    agentHost,
    exec,
    intents: options.intents ?? createMemorySessionIntentStore(),
    conversationReports: options.conversationReports,
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
  it('starts eagerly and output attachment does not spawn', async () => {
    const { runtime, spawner } = createRuntime();

    await runtime.outputLog({ conversationId: 'conversation-1' }).snapshot();
    expect(spawner.specs).toHaveLength(0);

    await expect(runtime.startSession(startInput())).resolves.toEqual(ok({ outcome: 'started' }));

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

    await runtime.outputLog({ conversationId: 'conversation-1' }).snapshot();
    expect(spawner.specs).toHaveLength(1);
  });

  it('trusts the workspace only when the start input opts in', async () => {
    const trustWorkspace = vi.fn(async () => {});
    const { runtime } = createRuntime({ trustWorkspace });

    await runtime.startSession(startInput());
    expect(trustWorkspace).not.toHaveBeenCalled();

    await runtime.startSession(
      startInput({ conversationId: 'conversation-2', trustWorkspace: true })
    );
    expect(trustWorkspace).toHaveBeenCalledWith(expect.any(Object), {
      workspacePath: '/workspace',
    });
  });

  it('wraps command execution with shellSetup and tmux', async () => {
    const { runtime, spawner } = createRuntime();

    await runtime.startSession(
      startInput({
        shellSetup: 'source ~/.profile',
        tmuxSessionName: 'emdash-test',
      })
    );

    expect(spawner.specs[0]!.command).toBe('/bin/sh');
    expect(spawner.specs[0]!.args[0]).toBe('-c');
    expect(spawner.specs[0]!.args[1]).toContain('tmux -u attach-session');
    expect(spawner.specs[0]!.args[1]).toContain('emdash-test');
    expect(spawner.specs[0]!.args[1]).toContain("source ~/.profile && agent run 'hello world'");
  });

  it('attaches to an already running session without replacing config', async () => {
    const { runtime, spawner, agentHost } = createRuntime();

    await expect(runtime.startSession(startInput({ initialPrompt: 'first' }))).resolves.toEqual(
      ok({ outcome: 'started' })
    );
    await expect(
      runtime.resumeSession(
        startInput({ initialPrompt: 'second', sessionId: 'provider-session', cols: 90 })
      )
    ).resolves.toEqual(ok({ outcome: 'attached' }));

    expect(spawner.specs).toHaveLength(1);
    expect(agentHost.buildPromptCommand).toHaveBeenCalledTimes(1);
    expect(spawner.specs[0]!.cols).toBe(120);
  });

  it('returns a typed spawn failure when the PTY cannot be created', async () => {
    const { runtime, spawner } = createRuntime();
    spawner.failWith = new Error('spawn failed');

    const result = await runtime.startSession(startInput());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({
        type: 'spawn-failed',
        conversationId: 'conversation-1',
        message: 'Error: spawn failed',
      });
    }
    expect(peek(runtime.sessionsLiveHost().get(undefined)!.states.list)).toMatchObject({
      'conversation-1': { status: 'exited' },
    });
  });

  it('stops and deletes sessions while cleaning up tmux', async () => {
    const { runtime, spawner, exec } = createRuntime();

    await runtime.startSession(startInput({ tmuxSessionName: 'emdash-test' }));
    runtime.stopSession('conversation-1');

    expect(spawner.processes[0]!.kill).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(exec.exec).toHaveBeenCalledWith('tmux', ['kill-session', '-t', 'emdash-test']);
    });

    await runtime.startSession(startInput({ tmuxSessionName: 'emdash-test' }));
    runtime.deleteSession('conversation-1');

    await vi.waitFor(() => {
      expect(exec.exec).toHaveBeenCalledTimes(2);
    });
  });

  it('falls back to a fresh session when resume exits immediately', async () => {
    const { runtime, spawner, agentHost } = createRuntime();

    const result = await runtime.resumeSession(startInput({ sessionId: 'provider-session' }));
    expect(result).toEqual(ok({ outcome: 'resumed' }));

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

    await runtime.startSession(startInput());

    await clock.advanceBy(1_200);

    expect(peek(runtime.sessionsLiveHost().get(undefined)!.states.list)).toEqual({});
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

    await runtime.startSession(startInput({ tmuxSessionName: 'emdash-test' }));

    await clock.advanceBy(1_200);

    expect(exec).toHaveBeenCalledWith('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_activity}',
    ]);
    expect(spawner.processes[0]!.kill).not.toHaveBeenCalled();
    expect(peek(runtime.sessionsLiveHost().get(undefined)!.states.list)).toHaveProperty(
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

    expect(spawner.specs).toHaveLength(1);
    expect(peek(runtime.sessionsLiveHost().get(undefined)!.states.list)).toHaveProperty(
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

    await runtime.startSession(startInput({ tmuxSessionName: 'emdash-test' }));
    await vi.waitFor(() => expect(intents.snapshot()).toHaveLength(1));

    runtime.killSession('conversation-1');

    expect(spawner.processes[0]!.kill).toHaveBeenCalled();
    await vi.waitFor(() => expect(intents.snapshot()).toEqual([]));
  });
});

// Property conv.sole-writer / spec §7.4: session facts (spawn, hook-captured provider id,
// activity, end, resume outcome) flow from the TUI runtime into the conversation index via
// lifecycle reports.
describe('TuiAgentsRuntime conversation lifecycle reports', () => {
  it('reports a fresh session start with no provider session id and no resume outcome', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const { runtime } = createRuntime({ conversationReports: reports });

    await runtime.startSession(startInput());

    expect(reports.started).toEqual([
      { id: 'conversation-1', providerSessionId: null, resumeOutcome: null },
    ]);
    expect(reports.activities).toContain('conversation-1');
  });

  it('reports the caller-declared emdash-chosen handle on a fresh spawn (spec §3.1)', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const { runtime } = createRuntime({ conversationReports: reports });

    await runtime.startSession(startInput({ chosenSessionId: 'conversation-1' }));

    expect(reports.started).toEqual([
      { id: 'conversation-1', providerSessionId: 'conversation-1', resumeOutcome: null },
    ]);
  });

  it("reports 'loaded' on resume and 'replaced-by-new' when the resume spawn exits early", async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const { runtime, spawner } = createRuntime({ conversationReports: reports });

    await runtime.resumeSession(startInput({ sessionId: 'provider-session' }));
    expect(reports.started).toEqual([
      { id: 'conversation-1', providerSessionId: 'provider-session', resumeOutcome: 'loaded' },
    ]);

    spawner.processes[0]!.emitExit({ exitCode: 0, signal: null });
    await vi.waitFor(() => {
      expect(reports.started).toHaveLength(2);
    });
    expect(reports.started[1]).toEqual({
      id: 'conversation-1',
      providerSessionId: null,
      resumeOutcome: 'replaced-by-new',
    });
  });

  it('reports hook-captured provider session ids through the id-changed callback', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const { runtime } = createRuntime({ conversationReports: reports });
    await runtime.startSession(startInput());

    // The hook server -> pipeline chain needs a live HTTP round-trip, so drive the state
    // seam it lands on directly; the runtime's constructor callback is what is under test.
    runtime['agentStates'].setProviderSessionId('conversation-1', 'captured-session');

    expect(reports.providerIds).toEqual([
      { id: 'conversation-1', providerSessionId: 'captured-session' },
    ]);
  });

  it('reports session end on stop and on process exit', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const { runtime, spawner } = createRuntime({ conversationReports: reports });

    await runtime.startSession(startInput());
    runtime.stopSession('conversation-1');
    expect(reports.ended).toEqual(['conversation-1']);

    await runtime.startSession(startInput());
    spawner.processes[1]!.emitExit({ exitCode: 0, signal: null });
    await vi.waitFor(() => {
      expect(reports.ended).toEqual(['conversation-1', 'conversation-1']);
    });
  });
});
