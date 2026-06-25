/**
 * Reusable test helpers for AcpSessionRuntime tests.
 *
 * Not a test file itself (no `.test.` suffix) — Vitest will not collect it.
 * Import from `./acp-test-support` in test files that need it.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Client } from '@agentclientprotocol/sdk';
import { vi } from 'vitest';
import type { AcpAgentApi, IAcpBehavior } from '../agents/plugins/capabilities/acp';
import type { AcpPermissionRequest } from './permissions';
import type {
  AcpRuntimeListener,
  AcpRuntimeLog,
  AcpSessionRuntimeDeps,
  AcpStartInput,
} from './runtime';
import type { AcpProcessHandle, AcpProcessHost, AcpFs } from './transport';
import type { AcpTurn, SessionLifecycle } from './turns';

// ---------------------------------------------------------------------------
// Recording listener
// ---------------------------------------------------------------------------

/**
 * Creates a recording AcpRuntimeListener.
 * `emitted(field)` returns all objects emitted via that method.
 */
export function createRecordingListener() {
  const states: {
    conversationId: string;
    lifecycle: SessionLifecycle;
    activeTurnId: string | null;
  }[] = [];
  const updates: { conversationId: string; turnId: string; seq: number }[] = [];
  const turns: { conversationId: string; turn: AcpTurn }[] = [];
  const permissionRequests: AcpPermissionRequest[] = [];
  const permissionResolved: { conversationId: string; requestId: string }[] = [];
  const closed: { conversationId: string; taskId: string; exitCode: number | null }[] = [];
  const agentEvents: { type: string; conversationId: string }[] = [];

  const listener: AcpRuntimeListener = {
    onState: (e) => states.push(e),
    onSessionUpdate: (e) => updates.push(e),
    onTurnCommitted: (e) => turns.push(e),
    onPermissionRequest: (req) => permissionRequests.push(req),
    onPermissionResolved: (e) => permissionResolved.push(e),
    onClosed: (e) => closed.push(e),
    onAgentEvent: (e) => agentEvents.push(e),
  };

  return {
    listener,
    states,
    updates,
    turns,
    permissionRequests,
    permissionResolved,
    closed,
    agentEvents,
    clear() {
      states.length = 0;
      updates.length = 0;
      turns.length = 0;
      permissionRequests.length = 0;
      permissionResolved.length = 0;
      closed.length = 0;
      agentEvents.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// FakeAcpAgent
// ---------------------------------------------------------------------------

/**
 * An injectable fake that implements AcpAgentApi.
 * After the plugin's `connect(io, toClient)` is called, `capturedClient`
 * holds the runtime's inbound Client handler.
 */
export class FakeAcpAgent implements AcpAgentApi {
  initialize = vi.fn().mockResolvedValue({ protocolVersion: 1 });
  newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
  loadSession = vi.fn().mockResolvedValue({});
  closeSession = vi.fn().mockResolvedValue({});
  cancel = vi.fn().mockResolvedValue({});
  prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
  setSessionConfigOption = vi.fn().mockResolvedValue({});

  /** The Client handler the runtime registered via toClient(). Available after connect(). */
  capturedClient: Client | null = null;

  readonly behavior: Pick<IAcpBehavior, 'connect'> = {
    connect: (_io, toClient) => {
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
// FakeAcpProcessHandle
// ---------------------------------------------------------------------------

export class FakeAcpProcessHandle extends EventEmitter implements AcpProcessHandle {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  readonly kill = vi.fn<(signal?: NodeJS.Signals) => void>();

  onExit(cb: (code: number | null) => void): void {
    this.on('exit', (code: number | null) => cb(code));
  }

  onError(cb: (err: Error) => void): void {
    this.on('error', cb);
  }

  emitExit(code: number | null = null): void {
    this.exitCode = code;
    this.emit('exit', code);
  }

  emitError(err: Error): void {
    this.emit('error', err);
  }
}

// Alias for backward compat.
export { FakeAcpProcessHandle as FakeChildProcess };

// ---------------------------------------------------------------------------
// FakeAcpProcessHost
// ---------------------------------------------------------------------------

export const fakeAcpFs: AcpFs = {
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
};

export class FakeAcpProcessHost implements AcpProcessHost {
  readonly fs: AcpFs = fakeAcpFs;
  private readonly handles: FakeAcpProcessHandle[] = [];

  resolveSpawnContext = vi.fn().mockResolvedValue({
    cli: '/usr/local/bin/fake-agent',
    agentEnv: {},
  });

  async spawn(_spec: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  }): Promise<AcpProcessHandle> {
    const handle = new FakeAcpProcessHandle();
    this.handles.push(handle);
    return handle;
  }

  get lastHandle(): FakeAcpProcessHandle {
    const h = this.handles.at(-1);
    if (!h) throw new Error('FakeAcpProcessHost: no handle spawned yet');
    return h;
  }

  get allHandles(): FakeAcpProcessHandle[] {
    return this.handles;
  }
}

// ---------------------------------------------------------------------------
// makeAcpHarness
// ---------------------------------------------------------------------------

export function makeAcpHarness(depOverrides: Partial<AcpSessionRuntimeDeps> = {}) {
  const recording = createRecordingListener();
  const agent = new FakeAcpAgent();
  const fakeHost = new FakeAcpProcessHost();

  const noop = () => {};
  const noopLog: AcpRuntimeLog = { debug: noop, info: noop, warn: noop, error: noop };

  const deps: AcpSessionRuntimeDeps = {
    resolveAcp: () => ({
      behavior: {
        buildSpawn: () => ({ command: '/fake/node', args: ['agent.js'], env: {} }),
        connect: agent.behavior.connect,
      },
    }),
    host: fakeHost,
    persistSessionId: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    persistModel: vi.fn().mockResolvedValue(undefined),
    listener: recording.listener,
    log: noopLog,
    ...depOverrides,
  };

  return {
    deps,
    fakeHost,
    recording,
    /** Typed states emitted (shortcut). */
    get states() {
      return recording.states;
    },
    /** The last FakeAcpProcessHandle spawned by the harness. */
    get lastChild(): FakeAcpProcessHandle {
      return fakeHost.lastHandle;
    },
    get children(): FakeAcpProcessHandle[] {
      return fakeHost.allHandles;
    },
    agent,
    client(): Client {
      if (!agent.capturedClient) {
        throw new Error('capturedClient is null — has start() been called?');
      }
      return agent.capturedClient;
    },
  };
}

// ---------------------------------------------------------------------------
// AcpStartInput factory
// ---------------------------------------------------------------------------

export function makeStartInput(
  overrides: Partial<AcpStartInput> & { conversationId?: string } = {}
): AcpStartInput {
  return {
    conversationId: overrides.conversationId ?? 'conv-1',
    projectId: 'proj-1',
    taskId: 'task-1',
    providerId: 'claude',
    workspaceId: 'ws-1',
    cwd: '/tmp/workspace',
    sessionId: null,
    model: null,
    ...overrides,
  };
}
