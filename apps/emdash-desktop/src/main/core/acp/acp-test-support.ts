/**
 * Reusable test helpers for AcpSessionManager tests.
 *
 * Not a test file itself (no `.test.` suffix) — Vitest will not collect it.
 * Import from `./acp-test-support` in test files that need it.
 */

import type { SpawnOptionsWithStdioTuple, StdioPipe } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Client } from '@agentclientprotocol/sdk';
import type { AcpAgentApi, IAcpBehavior } from '@emdash/core/agents/plugins';
import { vi } from 'vitest';
import type { AgentEvent } from '@shared/core/agents/agentEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import { createEventEmitter } from '@shared/lib/ipc/events';
import type { AcpSessionManagerDeps, AcpSessionManagerLog } from './acp-session-manager';

// ---------------------------------------------------------------------------
// Recording event emitter (replaces the vi.mock('@main/lib/events') pattern)
// ---------------------------------------------------------------------------

/**
 * Builds a real EventEmitter (via createEventEmitter) over a recording adapter.
 * No module mocking needed — inject `harness.events` into AcpSessionManagerDeps.
 *
 * `emittedOn(channel)` returns typed data for every emission on that channel.
 */
export function createRecordingEvents() {
  const recorded: { name: string; data: unknown }[] = [];
  const events = createEventEmitter({
    emit: (name, data) => recorded.push({ name, data }),
    on: () => () => {},
  });
  return {
    events,
    emittedOn<T>(ch: { name: string }): T[] {
      return recorded.filter((r) => r.name === ch.name).map((r) => r.data as T);
    },
    clear() {
      recorded.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// FakeAcpAgent — replaces mockConnection + capturedHandlerFactory
// ---------------------------------------------------------------------------

/**
 * An injectable fake that implements AcpAgentApi.
 * After the plugin's `connect(io, toClient)` is called, `capturedClient`
 * holds the manager's inbound Client handler — use it to push sessionUpdate
 * and requestPermission calls from the "agent" side.
 */
export class FakeAcpAgent implements AcpAgentApi {
  initialize = vi.fn().mockResolvedValue({ protocolVersion: 1 });
  newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
  loadSession = vi.fn().mockResolvedValue({});
  closeSession = vi.fn().mockResolvedValue({});
  cancel = vi.fn().mockResolvedValue({});
  prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
  setSessionConfigOption = vi.fn().mockResolvedValue({});

  /** The Client handler the manager registered via toClient(). Available after connect(). */
  capturedClient: Client | null = null;

  /** Convenience: the IAcpBehavior.connect implementation that installs this fake. */
  readonly behavior: Pick<IAcpBehavior, 'connect'> = {
    connect: (_io, toClient) => {
      // Capture the manager's client handler and return this fake as the agent.
      this.capturedClient = toClient(this as never);
      return this;
    },
  };

  reset() {
    this.initialize = vi.fn().mockResolvedValue({ protocolVersion: 1 });
    this.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    this.loadSession = vi.fn().mockResolvedValue({});
    this.closeSession = vi.fn().mockResolvedValue({});
    this.cancel = vi.fn().mockResolvedValue({});
    this.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
    this.setSessionConfigOption = vi.fn().mockResolvedValue({});
    this.capturedClient = null;
  }
}

// ---------------------------------------------------------------------------
// FakeChildProcess — replaces mockChild, enables handlePoolClosed testing
// ---------------------------------------------------------------------------

/**
 * A minimal fake ChildProcess backed by real PassThrough streams.
 * `emitExit(code)` / `emitError(err)` let tests drive the pool teardown path
 * (handlePoolClosed) that was previously impossible to reach.
 */
export class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  readonly kill = vi.fn<(signal?: NodeJS.Signals) => boolean>().mockReturnValue(true);

  emitExit(code: number | null = null): void {
    this.exitCode = code;
    this.emit('exit', code);
  }

  emitError(err: Error): void {
    this.emit('error', err);
  }
}

// ---------------------------------------------------------------------------
// makeAcpHarness — assembles all fakes + deps in one call
// ---------------------------------------------------------------------------

/**
 * Creates a harness holding all injected fakes for one test.
 *
 * Usage:
 * ```ts
 * const h = makeAcpHarness();
 * const mgr = new AcpSessionManager(h.deps);
 * await mgr.start(conv, 'ws-1', '/workspace');
 * expect(h.emittedOn(acpSessionStateChannel)).toHaveLength(1);
 * ```
 */
export function makeAcpHarness(depOverrides: Partial<AcpSessionManagerDeps> = {}) {
  const recording = createRecordingEvents();
  const agent = new FakeAcpAgent();
  const children: FakeChildProcess[] = [];

  const noop = () => {};
  const noopLog: AcpSessionManagerLog = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
  };

  function makeFakeChild(): FakeChildProcess {
    const child = new FakeChildProcess();
    children.push(child);
    return child;
  }

  const deps: AcpSessionManagerDeps = {
    // Tests only use the acp capability slice — cast through unknown to avoid structural mismatch.
    getPlugin: (() => ({
      capabilities: {
        acp: { kind: 'supported' },
        hostDependency: { binaryNames: ['claude'] },
      },
      behavior: {
        acp: {
          buildSpawn: () => ({ command: '/fake/node', args: ['agent.js'], env: {} }),
          connect: agent.behavior.connect,
        },
      },
    })) as unknown as AcpSessionManagerDeps['getPlugin'],
    resolveSpawnContext: async () => ({
      cli: '/usr/local/bin/claude',
      agentEnv: {},
    }),
    spawn: ((_cmd: string, _args: string[], _opts: SpawnOptionsWithStdioTuple<StdioPipe, StdioPipe, StdioPipe>) =>
      makeFakeChild()) as unknown as AcpSessionManagerDeps['spawn'],
    events: recording.events,
    setProviderSessionId: vi.fn().mockResolvedValue(true),
    updateConversationModel: vi.fn().mockResolvedValue(undefined),
    emitAgentEvent: vi.fn<(event: AgentEvent) => void>(),
    fs: {
      readFile: vi.fn().mockResolvedValue(''),
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
    log: noopLog,
    ...depOverrides,
  };

  return {
    deps,
    /** Typed emitted events for a given channel. */
    emittedOn: recording.emittedOn.bind(recording),
    /** Clear all recorded emissions (useful mid-test). */
    clearEvents: recording.clear.bind(recording),
    /** The last FakeChildProcess spawned by the harness. */
    get lastChild(): FakeChildProcess {
      const c = children.at(-1);
      if (!c) throw new Error('No child process has been spawned yet');
      return c;
    },
    /** All children spawned so far. */
    get children(): FakeChildProcess[] {
      return children;
    },
    /** The FakeAcpAgent — access .capturedClient after start() to drive inbound events. */
    agent,
    /** Convenience: the inbound Client handler registered by the manager. Call after start(). */
    client(): Client {
      if (!agent.capturedClient) {
        throw new Error('capturedClient is null — has start() been called?');
      }
      return agent.capturedClient;
    },
    recording,
  };
}

// ---------------------------------------------------------------------------
// Conversation factory
// ---------------------------------------------------------------------------

export function makeConversation(
  overrides: { conversationId?: string; providerSessionId?: string; model?: string } = {}
): Conversation {
  return {
    id: overrides.conversationId ?? 'conv-1',
    providerId: 'claude',
    projectId: 'proj-1',
    taskId: 'task-1',
    providerSessionId: overrides.providerSessionId,
    model: overrides.model,
    type: 'acp',
    title: 'Test Chat',
    lastInteractedAt: null,
    isInitialConversation: false,
  };
}
