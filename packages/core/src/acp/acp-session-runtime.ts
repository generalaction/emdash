import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type {
  Client,
  CreateTerminalRequest,
  CreateTerminalResponse,
  InitializeRequest,
  InitializeResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  LoadSessionRequest,
  NewSessionRequest,
  PromptResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SetSessionConfigOptionRequest,
  StopReason,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { AcpAgentApi } from '../agents/plugins/capabilities/acp';
import type { AcpPermissionRequest } from './permissions';
import type { AcpSessionRuntimeDeps, AcpStartInput, IAcpSessionRuntime } from './runtime';
import type { TerminalSnapshot } from './terminals';
import type {
  AcpProcessHandle,
  AcpProcessHost,
  AcpTerminalExit,
  AcpTerminalProcess,
} from './transport';
import type {
  AcpPromptImage,
  AcpTurn,
  ChatHistory,
  SessionLifecycle,
  SessionState,
  TurnSource,
  TurnStatus,
} from './turns';

// ---------------------------------------------------------------------------
// ManagedTerminal
// ---------------------------------------------------------------------------

/** Default per-terminal output byte cap (4 MB). */
const DEFAULT_OUTPUT_BYTE_LIMIT = 4 * 1024 * 1024;

/**
 * Owns the lifecycle of a single ACP-requested terminal command.
 * Buffers stdout+stderr output up to an optional byte limit (ring-buffer:
 * oldest bytes are discarded first, `truncated` is set to true).
 * Output chunks are decoded incrementally with StringDecoder so multibyte
 * UTF-8 sequences are never split across chunk boundaries.
 */
class ManagedTerminal {
  private readonly decoder = new StringDecoder('utf8');
  private readonly chunks: string[] = [];
  private bytes = 0;
  private _truncated = false;
  private _exitStatus: AcpTerminalExit | null = null;
  private readonly waiters: ((s: AcpTerminalExit) => void)[] = [];
  private readonly byteLimit: number;
  private readonly proc: AcpTerminalProcess;

  readonly terminalId: string;
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;

  constructor(
    terminalId: string,
    command: string,
    args: string[],
    cwd: string,
    proc: AcpTerminalProcess,
    private readonly onOutput: (chunk: string, truncated: boolean) => void,
    private readonly onExitCb: (status: AcpTerminalExit) => void,
    byteLimit?: number | null
  ) {
    this.terminalId = terminalId;
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.proc = proc;
    this.byteLimit = byteLimit ?? DEFAULT_OUTPUT_BYTE_LIMIT;

    const handleData = (d: Buffer) => this.append(d);
    proc.stdout.on('data', handleData);
    proc.stderr?.on('data', handleData);

    proc.onExit((status) => {
      this._exitStatus = status;
      this.waiters.splice(0).forEach((w) => w(status));
      this.onExitCb(status);
    });
  }

  private append(d: Buffer): void {
    const text = this.decoder.write(d);
    if (!text) return;

    const incoming = Buffer.byteLength(text, 'utf8');
    this.bytes += incoming;

    if (this.bytes > this.byteLimit) {
      // Discard oldest chunks until we're under the limit.
      this._truncated = true;
      while (this.chunks.length > 0 && this.bytes > this.byteLimit) {
        const oldest = this.chunks.shift()!;
        this.bytes -= Buffer.byteLength(oldest, 'utf8');
      }
    }

    this.chunks.push(text);
    this.onOutput(text, this._truncated);
  }

  snapshot(): TerminalSnapshot {
    return {
      terminalId: this.terminalId,
      command: this.command,
      args: this.args,
      cwd: this.cwd,
      output: this.chunks.join(''),
      truncated: this._truncated,
      exitStatus: this._exitStatus,
    };
  }

  waitForExit(): Promise<AcpTerminalExit> {
    if (this._exitStatus) return Promise.resolve(this._exitStatus);
    return new Promise<AcpTerminalExit>((resolve) => this.waiters.push(resolve));
  }

  kill(): void {
    try {
      this.proc.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  dispose(): void {
    this.kill();
    this.chunks.length = 0;
    this.bytes = 0;
    this.waiters.splice(0);
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Per-conversation state held inside a pool. */
interface AcpConversation {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: string;
  /** ACP-native session id assigned by newSession / loadSession. */
  acpSessionId: string | null;
  /** Model to apply after session is established (from persisted config). */
  pendingModel: string | null;
  /** All turns for this conversation (committed + at most one active). */
  turns: AcpTurn[];
  /** Id of the currently-active turn, or null when idle. */
  activeTurnId: string | null;
  /** Monotonic per-conversation sequence counter for cross-reload dedup. */
  nextSeq: number;
  /** Coarse session lifecycle state. */
  lifecycle: SessionLifecycle;
  /**
   * Serializable FIFO queue of pending permission requests. Persisted in
   * main-process memory so a renderer reload can rehydrate the queue via
   * getSessionState without losing pending decisions.
   */
  pendingPermissions: AcpPermissionRequest[];
  /** Active terminals managed by this conversation. */
  terminals: Map<string, ManagedTerminal>;
}

/**
 * One child process + connection shared by all conversations in a
 * (provider, workspace) pair.  poolKey = `${providerId}:${workspaceId}`.
 */
interface AcpPool {
  handle: AcpProcessHandle;
  host: AcpProcessHost;
  connection: AcpAgentApi;
  providerId: string;
  workspaceId: string;
  path: string;
  /** All conversations currently multiplexed on this connection. */
  conversations: Map<string, AcpConversation>;
  /** Maps ACP sessionId → conversationId for routing incoming events. */
  sessionToConversation: Map<string, string>;
  /** Conversations currently awaiting loadSession so unknown-sessionId notifications can be routed. */
  loadingConversations: Set<string>;
  /** Promise that resolves once the pool's `initialize` call completes. */
  initialized: Promise<void> | null;
  stopped: boolean;
}

// ---------------------------------------------------------------------------
// AcpSessionRuntime
// ---------------------------------------------------------------------------

/**
 * Machine-agnostic ACP session engine.
 *
 * Manages a pool-per-(provider,workspace) within a single machine: the
 * desktop AcpSessionManager creates one AcpSessionRuntime per host and routes
 * calls to the appropriate runtime. For SSH the same runtime class is used
 * with a LegacySshAcpProcessHost injected as the transport.
 */
export class AcpSessionRuntime implements IAcpSessionRuntime {
  private readonly deps: Required<AcpSessionRuntimeDeps>;

  /** Pools keyed by `${providerId}:${workspaceId}`. */
  private pools = new Map<string, AcpPool>();

  /**
   * Secondary index: conversationId → { poolKey, acpSessionId } for fast
   * lookup from the public API without scanning pools.
   */
  private conversationIndex = new Map<string, { poolKey: string; acpSessionId: string | null }>();

  /**
   * Non-serializable resolver callbacks for pending permission requests,
   * keyed by requestId.
   */
  private permissionResolvers = new Map<string, (r: RequestPermissionResponse) => void>();

  constructor(deps: AcpSessionRuntimeDeps) {
    const noop = () => {};
    const noopLog = { debug: noop, info: noop, warn: noop, error: noop };
    const log = deps.log ?? noopLog;
    this.deps = { ...deps, log };
  }

  // -------------------------------------------------------------------------
  // Public API (keyed by conversationId)
  // -------------------------------------------------------------------------

  async start(input: AcpStartInput): Promise<void> {
    const { conversationId, providerId, workspaceId, cwd, sessionId, model, initialPrompt } = input;

    if (this.conversationIndex.has(conversationId)) {
      this.deps.log.debug('AcpSessionRuntime: conversation already running', { conversationId });
      const conv = this.resolveConv(conversationId);
      if (conv) this.emitState(conv);
      return;
    }

    const binding = this.deps.resolveAcp(providerId);
    if (!binding) {
      throw new Error(`AcpSessionRuntime: provider '${providerId}' does not support ACP transport`);
    }

    // Reserve a slot synchronously before the first await so concurrent start() calls
    // cannot both proceed past the has() guard above (double-newSession prevention).
    const poolKey = `${providerId}:${workspaceId}`;
    this.conversationIndex.set(conversationId, { poolKey, acpSessionId: null });

    const pool = await this.getOrCreatePool(poolKey, providerId, workspaceId, cwd, binding);

    if (pool.initialized) {
      await pool.initialized;
    }

    const conv: AcpConversation = {
      conversationId,
      projectId: input.projectId,
      taskId: input.taskId,
      providerId,
      acpSessionId: sessionId,
      pendingModel: model,
      turns: [],
      activeTurnId: null,
      nextSeq: 0,
      lifecycle: 'starting',
      pendingPermissions: [],
      terminals: new Map(),
    };

    pool.conversations.set(conversationId, conv);
    this.conversationIndex.set(conversationId, { poolKey, acpSessionId: conv.acpSessionId });

    this.emitState(conv);

    try {
      let acpSessionId: string;

      if (conv.acpSessionId) {
        const originalSessionId = conv.acpSessionId;
        pool.sessionToConversation.set(originalSessionId, conversationId);
        pool.loadingConversations.add(conversationId);
        this.openTurn(conv, 'replay');
        try {
          await pool.connection.loadSession!(this.buildLoadSessionRequest(cwd, originalSessionId));
          this.closeTurn(conv, 'complete');
          acpSessionId = conv.acpSessionId;
          if (acpSessionId !== originalSessionId) {
            pool.sessionToConversation.delete(originalSessionId);
          }
        } catch {
          this.deps.log.warn('AcpSessionRuntime: loadSession failed, starting new session', {
            conversationId,
          });
          this.closeTurn(conv, 'complete');
          pool.sessionToConversation.delete(originalSessionId);
          if (conv.acpSessionId !== originalSessionId) {
            pool.sessionToConversation.delete(conv.acpSessionId!);
          }
          const newResp = await pool.connection.newSession(this.buildNewSessionRequest(cwd));
          acpSessionId = newResp.sessionId;
        } finally {
          pool.loadingConversations.delete(conversationId);
        }
      } else {
        const newResp = await pool.connection.newSession(this.buildNewSessionRequest(cwd));
        acpSessionId = newResp.sessionId;
      }

      conv.acpSessionId = acpSessionId;
      pool.sessionToConversation.set(acpSessionId, conversationId);
      this.conversationIndex.set(conversationId, { poolKey, acpSessionId });

      void this.deps
        .persistSessionId(conversationId, acpSessionId)
        .then((result) => {
          if (!result.success) {
            this.deps.log.warn('AcpSessionRuntime: failed to persist session id', {
              conversationId,
              error: result.error.type,
            });
          }
        })
        .catch(() => {});

      if (conv.pendingModel) {
        await this.applyModelInternal(pool.connection, acpSessionId, conv.pendingModel, conv);
      }

      conv.lifecycle = 'ready';
      this.emitState(conv);

      if (initialPrompt?.trim()) {
        await this.sendPromptInternal(pool, conv, initialPrompt);
      }
    } catch (err) {
      this.deps.log.error('AcpSessionRuntime: failed to initialize ACP conversation', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
      for (const [sid, cId] of pool.sessionToConversation) {
        if (cId === conversationId) {
          pool.sessionToConversation.delete(sid);
        }
      }
      pool.conversations.delete(conversationId);
      this.conversationIndex.delete(conversationId);
      if (pool.conversations.size === 0) {
        this.destroyPool(pool);
      }
      throw err;
    }
  }

  async prompt(conversationId: string, text: string, images?: AcpPromptImage[]): Promise<void> {
    const { pool, conv } = this.resolveConversation(conversationId);
    await this.sendPromptInternal(pool, conv, text, images);
  }

  async cancel(conversationId: string): Promise<void> {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry?.acpSessionId) return;
    const pool = this.pools.get(entry.poolKey);
    if (!pool) return;
    try {
      await pool.connection.cancel({ sessionId: entry.acpSessionId });
    } catch (err) {
      this.deps.log.warn('AcpSessionRuntime: cancel failed', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  resolvePermission(conversationId: string, requestId: string, optionId: string | null): void {
    const conv = this.resolveConv(conversationId);
    const resolver = this.permissionResolvers.get(requestId);

    if (!resolver) {
      this.deps.log.warn('AcpSessionRuntime: resolvePermission for unknown requestId', {
        conversationId,
        requestId,
      });
      return;
    }

    if (conv) {
      conv.pendingPermissions = conv.pendingPermissions.filter((p) => p.requestId !== requestId);
    }

    this.permissionResolvers.delete(requestId);

    resolver(
      optionId
        ? { outcome: { outcome: 'selected', optionId } }
        : { outcome: { outcome: 'cancelled' } }
    );

    this.deps.listener.onPermissionResolved({ conversationId, requestId });
  }

  stop(conversationId: string): void {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry) return;
    const pool = this.pools.get(entry.poolKey);
    if (!pool) {
      this.conversationIndex.delete(conversationId);
      return;
    }
    const conv = pool.conversations.get(conversationId);

    if (conv?.acpSessionId && pool.connection.closeSession) {
      void pool.connection.closeSession({ sessionId: conv.acpSessionId }).catch(() => {});
      pool.sessionToConversation.delete(conv.acpSessionId);
    }

    pool.conversations.delete(conversationId);
    this.conversationIndex.delete(conversationId);

    if (conv) {
      this.drainPendingPermissions(conv);
      this.disposeTerminals(conv);
    }

    if (conv) {
      this.deps.listener.onClosed({
        conversationId: conv.conversationId,
        taskId: conv.taskId,
        exitCode: null,
      });
    }

    if (pool.conversations.size === 0) {
      this.destroyPool(pool);
    }
  }

  async setModel(conversationId: string, model: string): Promise<void> {
    const entry = this.conversationIndex.get(conversationId);
    const pool = entry ? this.pools.get(entry.poolKey) : undefined;
    const conv = pool ? pool.conversations.get(conversationId) : undefined;

    if (pool && conv && entry?.acpSessionId) {
      await this.applyModelInternal(pool.connection, entry.acpSessionId, model, conv);
    }

    void this.deps.persistModel(conversationId, model).catch((err) => {
      this.deps.log.warn('AcpSessionRuntime: failed to persist model selection', {
        conversationId,
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  isRunning(conversationId: string): boolean {
    return this.conversationIndex.has(conversationId);
  }

  getChatHistory(conversationId: string): ChatHistory {
    const conv = this.resolveConv(conversationId);
    if (!conv) return { turns: [], complete: true };
    return {
      turns: conv.turns.filter((t) => t.status !== 'active').map((t) => structuredClone(t)),
      complete: conv.lifecycle !== 'starting' && conv.lifecycle !== 'replaying',
    };
  }

  getSessionState(conversationId: string): SessionState {
    const conv = this.resolveConv(conversationId);
    if (!conv)
      return { lifecycle: 'closed', activeTurn: null, model: null, pendingPermissions: [] };
    const activeTurn = conv.activeTurnId
      ? (conv.turns.find((t) => t.id === conv.activeTurnId) ?? null)
      : null;
    return {
      lifecycle: conv.lifecycle,
      activeTurn: activeTurn ? structuredClone(activeTurn) : null,
      model: conv.pendingModel,
      pendingPermissions: structuredClone(conv.pendingPermissions),
    };
  }

  getTerminals(conversationId: string): TerminalSnapshot[] {
    const conv = this.resolveConv(conversationId);
    if (!conv) return [];
    return Array.from(conv.terminals.values()).map((t) => t.snapshot());
  }

  // -------------------------------------------------------------------------
  // Pool management
  // -------------------------------------------------------------------------

  private async getOrCreatePool(
    poolKey: string,
    providerId: string,
    workspaceId: string,
    path: string,
    binding: { behavior: import('../agents/plugins/capabilities/acp').IAcpBehavior }
  ): Promise<AcpPool> {
    const existing = this.pools.get(poolKey);
    if (existing) return existing;

    const host = this.deps.host;
    const { cli, agentEnv } = await host.resolveSpawnContext(providerId);

    const { command, args, env } = binding.behavior.buildSpawn({
      cwd: path,
      env: agentEnv,
      cli,
    });

    const handle = await host.spawn({
      command,
      args,
      env: { ...agentEnv, ...env },
      cwd: path,
    });

    if (handle.stderr) {
      handle.stderr.on('data', (data: Buffer) => {
        this.deps.log.debug('AcpSessionRuntime: agent stderr', {
          poolKey,
          text: data.toString().trim(),
        });
      });
    }

    const pool: AcpPool = {
      handle,
      host,
      connection: null as unknown as AcpAgentApi,
      providerId,
      workspaceId,
      path,
      conversations: new Map(),
      sessionToConversation: new Map(),
      loadingConversations: new Set(),
      initialized: null,
      stopped: false,
    };

    pool.connection = binding.behavior.connect(
      { stdin: handle.stdin, stdout: handle.stdout },
      (_agent) => this.buildClientHandler(pool)
    );

    this.pools.set(poolKey, pool);

    handle.onExit(() => {
      this.handlePoolClosed(pool);
    });

    handle.onError((err) => {
      this.deps.log.error('AcpSessionRuntime: agent process error', {
        poolKey,
        error: err.message,
      });
      this.handlePoolClosed(pool);
    });

    const initReq: InitializeRequest = {
      protocolVersion: 1,
      clientInfo: { name: 'emdash', version: '1' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: typeof pool.host.spawnTerminal === 'function',
      },
    };

    pool.initialized = pool.connection
      .initialize(initReq)
      .then((_resp: InitializeResponse) => {
        this.deps.log.debug('AcpSessionRuntime: pool initialized', { poolKey });
      })
      .catch((err) => {
        this.deps.log.error('AcpSessionRuntime: pool initialize failed', {
          poolKey,
          error: err instanceof Error ? err.message : String(err),
        });
        this.handlePoolClosed(pool);
        throw err;
      });

    return pool;
  }

  private destroyPool(pool: AcpPool): void {
    if (pool.stopped) return;
    pool.stopped = true;
    this.pools.delete(`${pool.providerId}:${pool.workspaceId}`);
    try {
      pool.handle.kill('SIGTERM');
    } catch {
      // ignore
    }
  }

  private handlePoolClosed(pool: AcpPool): void {
    if (pool.stopped) {
      for (const conv of pool.conversations.values()) {
        this.conversationIndex.delete(conv.conversationId);
      }
      return;
    }
    pool.stopped = true;
    this.pools.delete(`${pool.providerId}:${pool.workspaceId}`);

    const exitCode = pool.handle.exitCode;

    for (const conv of pool.conversations.values()) {
      this.conversationIndex.delete(conv.conversationId);

      if (conv.activeTurnId) {
        this.closeTurnInternal(conv, 'error');
      }

      this.drainPendingPermissions(conv);
      this.disposeTerminals(conv);

      conv.lifecycle = 'closed';
      this.emitState(conv);

      this.deps.listener.onClosed({
        conversationId: conv.conversationId,
        taskId: conv.taskId,
        exitCode,
      });
    }

    this.deps.log.debug('AcpSessionRuntime: pool closed', {
      poolKey: `${pool.providerId}:${pool.workspaceId}`,
      exitCode,
      conversationCount: pool.conversations.size,
    });

    pool.conversations.clear();
    pool.sessionToConversation.clear();
  }

  // -------------------------------------------------------------------------
  // Client handler (built once per pool, routes by sessionId)
  // -------------------------------------------------------------------------

  private buildClientHandler(pool: AcpPool): Client {
    return {
      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        const update = params.update;
        let conversationId = pool.sessionToConversation.get(params.sessionId);
        if (!conversationId && pool.loadingConversations.size > 0) {
          const pendingId = pool.loadingConversations.values().next().value;
          if (pendingId) {
            conversationId = pendingId;
            pool.sessionToConversation.set(params.sessionId, pendingId);
            const conv = pool.conversations.get(pendingId);
            if (conv) conv.acpSessionId = params.sessionId;
          }
        }
        if (!conversationId) {
          this.deps.log.warn('AcpSessionRuntime: sessionUpdate for unknown sessionId', {
            sessionId: params.sessionId,
          });
          return;
        }
        const conv = pool.conversations.get(conversationId);
        if (!conv) return;

        if (!conv.activeTurnId) {
          this.openTurn(conv, 'live');
        }
        const turn = conv.turns.find((t) => t.id === conv.activeTurnId)!;

        const seq = conv.nextSeq++;
        turn.updates.push({ seq, update });
        this.deps.listener.onSessionUpdate({
          conversationId,
          turnId: turn.id,
          update,
          seq,
        });
      },

      requestPermission: (params: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
        const conversationId = pool.sessionToConversation.get(params.sessionId);
        const conv = conversationId ? pool.conversations.get(conversationId) : undefined;

        if (!conv || !conversationId) {
          this.deps.log.warn('AcpSessionRuntime: requestPermission for unknown session', {
            sessionId: params.sessionId,
          });
          return Promise.resolve({ outcome: { outcome: 'cancelled' } });
        }

        const requestId = crypto.randomUUID();
        const payload: AcpPermissionRequest = {
          conversationId,
          requestId,
          toolCallId: params.toolCall?.toolCallId,
          title: params.toolCall?.title ?? 'Unknown',
          toolKind: params.toolCall?.kind ?? undefined,
          options: params.options.map((o) => ({
            optionId: o.optionId,
            name: o.name,
            kind: o.kind,
          })),
        };

        conv.pendingPermissions.push(payload);

        this.deps.log.debug('AcpSessionRuntime: requesting user permission', {
          conversationId,
          requestId,
          title: payload.title,
        });

        this.deps.listener.onPermissionRequest(payload);

        return new Promise<RequestPermissionResponse>((resolve) => {
          this.permissionResolvers.set(requestId, resolve);
        });
      },

      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        try {
          const content = await pool.host.fs.readFile(params.path, 'utf8');
          return { content };
        } catch (err) {
          throw new Error(
            `readTextFile failed for ${params.path}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      },

      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        await pool.host.fs.mkdir(dirname(params.path), { recursive: true });
        await pool.host.fs.writeFile(params.path, params.content, 'utf8');
        return {};
      },

      createTerminal: async (params: CreateTerminalRequest): Promise<CreateTerminalResponse> => {
        if (!pool.host.spawnTerminal) {
          throw new Error(
            'AcpSessionRuntime: host does not support terminal spawning (spawnTerminal is undefined)'
          );
        }
        const conv = this.convForSession(pool, params.sessionId);
        const terminalId = crypto.randomUUID();
        const envRecord = params.env
          ? Object.fromEntries(params.env.map((e) => [e.name, e.value]))
          : {};
        const resolvedCwd = params.cwd ?? pool.path;
        const proc = await pool.host.spawnTerminal({
          command: params.command,
          args: params.args ?? [],
          env: envRecord,
          cwd: resolvedCwd,
        });

        const terminal = new ManagedTerminal(
          terminalId,
          params.command,
          params.args ?? [],
          resolvedCwd,
          proc,
          (chunk, truncated) => {
            this.deps.listener.onTerminalOutput({
              conversationId: conv.conversationId,
              terminalId,
              chunk,
              truncated,
            });
          },
          (exitStatus) => {
            this.deps.listener.onTerminalExit({
              conversationId: conv.conversationId,
              terminalId,
              exitStatus,
            });
          },
          params.outputByteLimit
        );

        conv.terminals.set(terminalId, terminal);
        this.deps.listener.onTerminalCreated({
          conversationId: conv.conversationId,
          terminalId,
          command: params.command,
          args: params.args ?? [],
          cwd: resolvedCwd,
        });
        return { terminalId };
      },

      terminalOutput: async (params: TerminalOutputRequest): Promise<TerminalOutputResponse> => {
        const conv = this.convForSession(pool, params.sessionId);
        const terminal = conv.terminals.get(params.terminalId);
        if (!terminal) {
          throw new Error(`AcpSessionRuntime: terminal not found: ${params.terminalId}`);
        }
        const snap = terminal.snapshot();
        return {
          output: snap.output,
          truncated: snap.truncated,
          exitStatus: snap.exitStatus ?? undefined,
        };
      },

      waitForTerminalExit: async (
        params: WaitForTerminalExitRequest
      ): Promise<WaitForTerminalExitResponse> => {
        const conv = this.convForSession(pool, params.sessionId);
        const terminal = conv.terminals.get(params.terminalId);
        if (!terminal) {
          throw new Error(`AcpSessionRuntime: terminal not found: ${params.terminalId}`);
        }
        const status = await terminal.waitForExit();
        return { exitCode: status.exitCode, signal: status.signal ?? undefined };
      },

      killTerminal: async (params: KillTerminalRequest): Promise<KillTerminalResponse> => {
        const conv = this.convForSession(pool, params.sessionId);
        const terminal = conv.terminals.get(params.terminalId);
        if (!terminal) {
          throw new Error(`AcpSessionRuntime: terminal not found: ${params.terminalId}`);
        }
        terminal.kill();
        return {};
      },

      releaseTerminal: async (params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse> => {
        const conv = this.convForSession(pool, params.sessionId);
        const terminal = conv.terminals.get(params.terminalId);
        if (!terminal) {
          throw new Error(`AcpSessionRuntime: terminal not found: ${params.terminalId}`);
        }
        terminal.dispose();
        conv.terminals.delete(params.terminalId);
        this.deps.listener.onTerminalReleased({
          conversationId: conv.conversationId,
          terminalId: params.terminalId,
        });
        return {};
      },
    };
  }

  /** Resolve a conversation by ACP sessionId, throwing if not found. */
  private convForSession(pool: AcpPool, sessionId: string): AcpConversation {
    const conversationId = pool.sessionToConversation.get(sessionId);
    if (!conversationId) {
      throw new Error(`AcpSessionRuntime: no conversation for ACP sessionId ${sessionId}`);
    }
    const conv = pool.conversations.get(conversationId);
    if (!conv) {
      throw new Error(`AcpSessionRuntime: conversation ${conversationId} not found in pool`);
    }
    return conv;
  }

  // -------------------------------------------------------------------------
  // Turn lifecycle helpers
  // -------------------------------------------------------------------------

  private openTurn(conv: AcpConversation, source: TurnSource): AcpTurn {
    const turn: AcpTurn = {
      id: `turn-${conv.conversationId}-${conv.turns.length}`,
      status: 'active',
      source,
      startSeq: conv.nextSeq,
      endSeq: null,
      updates: [],
    };
    conv.turns.push(turn);
    conv.activeTurnId = turn.id;
    conv.lifecycle = source === 'replay' ? 'replaying' : 'working';
    this.emitState(conv);
    return turn;
  }

  private closeTurnInternal(conv: AcpConversation, status: Exclude<TurnStatus, 'active'>): void {
    const turn = conv.turns.find((t) => t.id === conv.activeTurnId);
    if (!turn) return;
    turn.status = status;
    turn.endSeq = conv.nextSeq;
    conv.activeTurnId = null;
    this.deps.listener.onTurnCommitted({
      conversationId: conv.conversationId,
      turn: structuredClone(turn),
    });
  }

  private closeTurn(conv: AcpConversation, status: Exclude<TurnStatus, 'active'>): void {
    this.closeTurnInternal(conv, status);
    if (conv.lifecycle !== 'closed') {
      conv.lifecycle = 'ready';
    }
    this.emitState(conv);
  }

  private emitState(conv: AcpConversation): void {
    this.deps.listener.onState({
      conversationId: conv.conversationId,
      lifecycle: conv.lifecycle,
      activeTurnId: conv.activeTurnId,
    });
  }

  private statusFromStopReason(r: StopReason): Exclude<TurnStatus, 'active'> {
    return r === 'cancelled' ? 'cancelled' : 'complete';
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private drainPendingPermissions(conv: AcpConversation): void {
    for (const pending of conv.pendingPermissions) {
      const resolver = this.permissionResolvers.get(pending.requestId);
      if (resolver) {
        this.permissionResolvers.delete(pending.requestId);
        resolver({ outcome: { outcome: 'cancelled' } });
      }
      this.deps.listener.onPermissionResolved({
        conversationId: conv.conversationId,
        requestId: pending.requestId,
      });
    }
    conv.pendingPermissions = [];
  }

  private disposeTerminals(conv: AcpConversation): void {
    for (const terminal of conv.terminals.values()) {
      terminal.dispose();
      this.deps.listener.onTerminalReleased({
        conversationId: conv.conversationId,
        terminalId: terminal.terminalId,
      });
    }
    conv.terminals.clear();
  }

  private resolveConv(conversationId: string): AcpConversation | null {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry) return null;
    const pool = this.pools.get(entry.poolKey);
    return pool?.conversations.get(conversationId) ?? null;
  }

  private resolveConversation(conversationId: string): { pool: AcpPool; conv: AcpConversation } {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry?.acpSessionId) {
      throw new Error(`AcpSessionRuntime: no active session for conversation ${conversationId}`);
    }
    const pool = this.pools.get(entry.poolKey);
    const conv = pool?.conversations.get(conversationId);
    if (!pool || !conv) {
      throw new Error(`AcpSessionRuntime: pool not found for conversation ${conversationId}`);
    }
    return { pool, conv };
  }

  private async sendPromptInternal(
    pool: AcpPool,
    conv: AcpConversation,
    text: string,
    images?: AcpPromptImage[]
  ): Promise<void> {
    if (!conv.acpSessionId) return;
    this.openTurn(conv, 'live');
    this.emitAgentEventInternal(conv, 'start');

    try {
      const res: PromptResponse = await pool.connection.prompt({
        sessionId: conv.acpSessionId,
        prompt: [
          ...(images ?? []).map((img) => ({
            type: 'image' as const,
            data: img.data,
            mimeType: img.mimeType,
          })),
          ...(text ? [{ type: 'text' as const, text }] : []),
        ],
      });
      this.closeTurn(conv, this.statusFromStopReason(res.stopReason));
      this.emitAgentEventInternal(conv, 'stop');
    } catch (err) {
      this.deps.log.error('AcpSessionRuntime: prompt error', {
        conversationId: conv.conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.closeTurn(conv, 'error');
      this.emitAgentEventInternal(conv, 'error');
    }
  }

  private async applyModelInternal(
    connection: AcpAgentApi,
    acpSessionId: string,
    model: string,
    conv: AcpConversation
  ): Promise<void> {
    if (!connection.setSessionConfigOption) return;
    try {
      const req: SetSessionConfigOptionRequest = {
        sessionId: acpSessionId,
        configId: 'model',
        value: model,
      };
      await connection.setSessionConfigOption(req);
      conv.pendingModel = model;
    } catch (err) {
      this.deps.log.warn('AcpSessionRuntime: failed to apply model selection', {
        conversationId: conv.conversationId,
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private buildNewSessionRequest(cwd: string): NewSessionRequest {
    return { cwd, mcpServers: [] };
  }

  private buildLoadSessionRequest(cwd: string, sessionId: string): LoadSessionRequest {
    return { sessionId, cwd, mcpServers: [] };
  }

  private emitAgentEventInternal(conv: AcpConversation, type: 'start' | 'stop' | 'error'): void {
    this.deps.listener.onAgentEvent({
      type,
      conversationId: conv.conversationId,
      projectId: conv.projectId,
      taskId: conv.taskId,
      providerId: conv.providerId,
    });
  }
}
