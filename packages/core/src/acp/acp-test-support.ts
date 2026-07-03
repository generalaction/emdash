/**
 * Reusable test helpers for AcpSessionRuntime tests.
 *
 * Not a test file itself (no `.test.` suffix) — Vitest will not collect it.
 * Import from `./acp-test-support` in test files that need it.
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { Client } from '@agentclientprotocol/sdk';
import { noopLogger } from '@emdash/shared/logger';
import { vi } from 'vitest';
import type { AcpAgentApi, IAcpBehavior } from '../agents/plugins/capabilities/acp';
import type { AgentState } from './models/agents';
import type { SessionConfigState, SessionUsage } from './models/config';
import type { PlanState } from './models/plan';
import type { SessionState } from './models/session';
import type { TranscriptTurn } from './models/turns';
import type { AcpRuntimeListener, AcpSessionRuntimeDeps, AcpStartInput } from './runtime';
import type {
  AcpProcessHandle,
  AcpProcessHost,
  AcpFs,
  AcpTerminalExit,
  AcpTerminalProcess,
} from './transport';

/**
 * Creates a recording AcpRuntimeListener.
 * `emitted(field)` returns all objects emitted via that method.
 */
export function createRecordingListener() {
  const snapshots: { conversationId: string; snapshot: SessionState }[] = [];
  const transcripts: {
    conversationId: string;
    committed: TranscriptTurn[];
    active: TranscriptTurn | null;
    config: SessionConfigState;
    usage: SessionUsage | null;
    title: string | null;
    agents: AgentState[];
    plan: PlanState | null;
  }[] = [];
  const closed: { conversationId: string; taskId: string; exitCode: number | null }[] = [];
  const agentEvents: { type: string; conversationId: string }[] = [];
  const terminalCreated: {
    conversationId: string;
    terminalId: string;
    command: string;
    args: string[];
    cwd: string;
  }[] = [];
  const terminalOutput: {
    conversationId: string;
    terminalId: string;
    chunk: string;
    truncated: boolean;
  }[] = [];
  const terminalExit: {
    conversationId: string;
    terminalId: string;
    exitStatus: AcpTerminalExit;
  }[] = [];
  const terminalReleased: { conversationId: string; terminalId: string }[] = [];

  const listener: AcpRuntimeListener = {
    onSnapshot: (e) => snapshots.push(e),
    onTranscript: (e) => transcripts.push(e),
    onClosed: (e) => closed.push(e),
    onAgentEvent: (e) => agentEvents.push(e),
    onTerminalCreated: (e) => terminalCreated.push(e),
    onTerminalOutput: (e) => terminalOutput.push(e),
    onTerminalExit: (e) => terminalExit.push(e),
    onTerminalReleased: (e) => terminalReleased.push(e),
  };

  return {
    listener,
    snapshots,
    transcripts,
    closed,
    agentEvents,
    terminalCreated,
    terminalOutput,
    terminalExit,
    terminalReleased,
    clear() {
      snapshots.length = 0;
      transcripts.length = 0;
      closed.length = 0;
      agentEvents.length = 0;
      terminalCreated.length = 0;
      terminalOutput.length = 0;
      terminalExit.length = 0;
      terminalReleased.length = 0;
    },
  };
}

/**
 * An injectable fake that implements AcpAgentApi.
 * After the plugin's `connect(io, toClient)` is called, `capturedClient`
 * holds the runtime's inbound Client handler.
 */
export class FakeAcpAgent implements AcpAgentApi {
  initialize = vi.fn().mockResolvedValue({
    protocolVersion: 1,
    agentCapabilities: { loadSession: true },
  });
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
    this.initialize = vi.fn().mockResolvedValue({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
    });
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
// FakeAcpTerminalProcess
// ---------------------------------------------------------------------------

/**
 * A controllable fake AcpTerminalProcess for use in tests.
 * Push output via `pushOutput(chunk)` and trigger exit via `triggerExit(status)`.
 */
export class FakeAcpTerminalProcess extends EventEmitter implements AcpTerminalProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  readonly killFn = vi.fn<(signal?: NodeJS.Signals) => void>();

  onExit(cb: (status: AcpTerminalExit) => void): void {
    this.on('exit', cb);
  }

  onError(cb: (err: Error) => void): void {
    this.on('error', cb);
  }

  kill(signal?: NodeJS.Signals): void {
    this.killFn(signal);
  }

  /** Push a chunk of text to stdout so ManagedTerminal buffers it. */
  pushOutput(chunk: string): void {
    this.stdout.push(chunk);
  }

  /** Simulate process exit. */
  triggerExit(status: AcpTerminalExit): void {
    this.exitCode = status.exitCode;
    this.emit('exit', status);
    this.stdout.push(null);
    this.stderr.push(null);
  }
}

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

export const fakeAcpFs: AcpFs = {
  readFile: vi.fn().mockResolvedValue(''),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
};

export class FakeAcpProcessHost implements AcpProcessHost {
  readonly fs: AcpFs = fakeAcpFs;
  private readonly handles: FakeAcpProcessHandle[] = [];
  private readonly terminalProcs: FakeAcpTerminalProcess[] = [];
  /** When set, the next spawnTerminal call returns this instance. */
  nextTerminal: FakeAcpTerminalProcess | null = null;
  readonly spawnTerminalFn =
    vi.fn<
      (spec: {
        command: string;
        args: string[];
        env: Record<string, string>;
        cwd: string;
      }) => Promise<AcpTerminalProcess>
    >();

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

  async spawnTerminal(spec: {
    command: string;
    args: string[];
    env: Record<string, string>;
    cwd: string;
  }): Promise<AcpTerminalProcess> {
    const proc = this.nextTerminal ?? new FakeAcpTerminalProcess();
    this.nextTerminal = null;
    this.terminalProcs.push(proc);
    this.spawnTerminalFn(spec);
    return proc;
  }

  get lastHandle(): FakeAcpProcessHandle {
    const h = this.handles.at(-1);
    if (!h) throw new Error('FakeAcpProcessHost: no handle spawned yet');
    return h;
  }

  get allHandles(): FakeAcpProcessHandle[] {
    return this.handles;
  }

  get lastTerminalProc(): FakeAcpTerminalProcess {
    const p = this.terminalProcs.at(-1);
    if (!p) throw new Error('FakeAcpProcessHost: no terminal spawned yet');
    return p;
  }

  get allTerminalProcs(): FakeAcpTerminalProcess[] {
    return this.terminalProcs;
  }
}

export function makeAcpHarness(depOverrides: Partial<AcpSessionRuntimeDeps> = {}) {
  const recording = createRecordingListener();
  const agent = new FakeAcpAgent();
  const fakeHost = new FakeAcpProcessHost();

  const deps: AcpSessionRuntimeDeps = {
    resolveAcp: () => ({
      behavior: {
        buildSpawn: () => ({ command: '/fake/node', args: ['agent.js'], env: {} }),
        connect: agent.behavior.connect,
      },
    }),
    host: fakeHost,
    persistSessionId: vi.fn().mockResolvedValue({ success: true, data: undefined }),
    resolveAttachment: vi.fn().mockResolvedValue({ data: '', mimeType: 'image/png' }),
    listener: recording.listener,
    logger: noopLogger,
    ...depOverrides,
  };

  return {
    deps,
    fakeHost,
    recording,
    /** Snapshots emitted (shortcut). */
    get snapshots() {
      return recording.snapshots;
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
