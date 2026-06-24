import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  Client,
  InitializeRequest,
  InitializeResponse,
  LoadSessionRequest,
  NewSessionRequest,
  PromptResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SetSessionConfigOptionRequest,
  StopReason,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { AcpAgentApi } from '@emdash/core/agents/plugins';
import type { getPlugin } from '@main/core/agents/plugin-registry';
import type { setProviderSessionId } from '@main/core/conversations/set-provider-session-id';
import type { updateConversationModel } from '@main/core/conversations/updateConversationModel';
import {
  acpPermissionRequestChannel,
  acpPermissionResolvedChannel,
  acpSessionClosedChannel,
  acpSessionStateChannel,
  acpSessionUpdateChannel,
  acpTurnCommittedChannel,
} from '@shared/core/acp/acpEvents';
import type { AcpPermissionRequest } from '@shared/core/acp/acpPermissions';
import type {
  AcpPromptImage,
  AcpTurn,
  ChatHistory,
  SessionLifecycle,
  SessionState,
  TurnSource,
  TurnStatus,
} from '@shared/core/acp/acpTurns';
import type { AgentEvent } from '@shared/core/agents/agentEvents';
import { agentSessionExitedChannel } from '@shared/core/agents/agentEvents';
import type { Conversation } from '@shared/core/conversations/conversations';
import type { createEventEmitter } from '@shared/lib/ipc/events';

// ---------------------------------------------------------------------------
// Types
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
}

/**
 * One child process + connection shared by all conversations in a
 * (provider, workspace) pair.  poolKey = `${providerId}:${workspaceId}`.
 */
interface AcpPool {
  child: ChildProcess;
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
// Deps interface (constructor injection, mirroring SshConnectionManagerDeps)
// ---------------------------------------------------------------------------

/** Minimal logger interface used by AcpSessionManager. */
export type AcpSessionManagerLog = {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

/** Minimal fs surface for the ACP client's readTextFile/writeTextFile handlers. */
export type AcpFs = {
  readFile: (path: string, encoding: 'utf8') => Promise<string>;
  writeFile: (path: string, content: string, encoding: 'utf8') => Promise<void>;
  mkdir: (path: string, opts: { recursive: boolean }) => Promise<unknown>;
};

export interface AcpSessionManagerDeps {
  getPlugin?: (providerId: string) => ReturnType<typeof getPlugin>;
  /**
   * Folds resolveAgentExecutable + new LocalExecutionContext() + hostDependencyStore +
   * localDependencyManager + buildAgentEnv into a single async call.
   * Optional — must be provided in production; tests inject a fake.
   */
  resolveSpawnContext?: (
    providerId: string,
    plugin: ReturnType<typeof getPlugin>
  ) => Promise<{ cli: string; agentEnv: Record<string, string> }>;
  spawn?: typeof nodeSpawn;
  /** Typed event emitter. Optional — must be provided in production; tests inject a recording emitter. */
  events?: Pick<ReturnType<typeof createEventEmitter>, 'emit'>;
  /** Optional — must be provided in production; tests inject a spy. */
  setProviderSessionId?: typeof setProviderSessionId;
  /** Optional — must be provided in production; tests inject a spy. */
  updateConversationModel?: typeof updateConversationModel;
  /** Folds agentHookService.emitAgentEvent(event, isAppFocused()). */
  emitAgentEvent?: (event: AgentEvent) => void;
  /** Replaces the node:fs/promises imports in the client handler. */
  fs?: AcpFs;
  log?: AcpSessionManagerLog;
}

// ---------------------------------------------------------------------------
// AcpSessionManager
// ---------------------------------------------------------------------------

export class AcpSessionManager {
  private readonly deps: Required<AcpSessionManagerDeps>;

  /** Pools keyed by `${providerId}:${workspaceId}`. */
  private pools = new Map<string, AcpPool>();

  /**
   * Secondary index: conversationId → { poolKey, acpSessionId } for fast
   * lookup from the public controller API without scanning pools.
   */
  private conversationIndex = new Map<string, { poolKey: string; acpSessionId: string | null }>();

  /**
   * Non-serializable resolver callbacks for pending permission requests,
   * keyed by requestId. Kept separate from AcpConversation.pendingPermissions
   * (which is serializable) because Promise callbacks cannot cross IPC.
   */
  private permissionResolvers = new Map<string, (r: RequestPermissionResponse) => void>();

  constructor(deps: AcpSessionManagerDeps = {}) {
    const noop = () => {};
    const noopLog: AcpSessionManagerLog = { debug: noop, info: noop, warn: noop, error: noop };
    const noopEvents = {
      emit: (_event: { name: string }, _data: unknown) => {},
    };
    const missingDep = (name: string) => () => {
      throw new Error(
        `AcpSessionManager: '${name}' dep was not provided. Pass it in the constructor.`
      );
    };

    this.deps = {
      getPlugin:
        deps.getPlugin ?? (missingDep('getPlugin') as Required<AcpSessionManagerDeps>['getPlugin']),
      resolveSpawnContext:
        deps.resolveSpawnContext ??
        (missingDep(
          'resolveSpawnContext'
        ) as Required<AcpSessionManagerDeps>['resolveSpawnContext']),
      spawn: deps.spawn ?? nodeSpawn,
      events: deps.events ?? (noopEvents as Required<AcpSessionManagerDeps>['events']),
      setProviderSessionId:
        deps.setProviderSessionId ??
        (missingDep(
          'setProviderSessionId'
        ) as Required<AcpSessionManagerDeps>['setProviderSessionId']),
      updateConversationModel:
        deps.updateConversationModel ??
        (missingDep(
          'updateConversationModel'
        ) as Required<AcpSessionManagerDeps>['updateConversationModel']),
      emitAgentEvent: deps.emitAgentEvent ?? noop,
      fs: deps.fs ?? { readFile, writeFile, mkdir },
      log: deps.log ?? noopLog,
    };
  }

  // -------------------------------------------------------------------------
  // Public API (keyed by conversationId)
  // -------------------------------------------------------------------------

  async start(
    conversation: Conversation,
    workspaceId: string,
    path: string,
    initialPrompt?: string
  ): Promise<void> {
    const { id: conversationId, providerId } = conversation;

    if (this.conversationIndex.has(conversationId)) {
      this.deps.log.debug('AcpSessionManager: conversation already running', { conversationId });
      const conv = this.resolveConv(conversationId);
      if (conv) this.emitState(conv);
      return;
    }

    const plugin = this.deps.getPlugin(providerId);
    if (!plugin || plugin.capabilities.acp.kind !== 'supported' || !plugin.behavior?.acp) {
      throw new Error(`AcpSessionManager: provider '${providerId}' does not support ACP transport`);
    }

    const poolKey = `${providerId}:${workspaceId}`;
    const pool = await this.getOrCreatePool(poolKey, providerId, workspaceId, path, plugin);

    if (pool.initialized) {
      await pool.initialized;
    }

    const conv: AcpConversation = {
      conversationId,
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      providerId,
      acpSessionId: conversation.providerSessionId ?? null,
      pendingModel: conversation.model ?? null,
      turns: [],
      activeTurnId: null,
      nextSeq: 0,
      lifecycle: 'starting',
      pendingPermissions: [],
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
          await pool.connection.loadSession!(this.buildLoadSessionRequest(path, originalSessionId));
          this.closeTurn(conv, 'complete');
          acpSessionId = conv.acpSessionId;
          if (acpSessionId !== originalSessionId) {
            pool.sessionToConversation.delete(originalSessionId);
          }
        } catch {
          this.deps.log.warn('AcpSessionManager: loadSession failed, starting new session', {
            conversationId,
          });
          this.closeTurn(conv, 'complete');
          pool.sessionToConversation.delete(originalSessionId);
          if (conv.acpSessionId !== originalSessionId) {
            pool.sessionToConversation.delete(conv.acpSessionId!);
          }
          const newResp = await pool.connection.newSession(this.buildNewSessionRequest(path));
          acpSessionId = newResp.sessionId;
        } finally {
          pool.loadingConversations.delete(conversationId);
        }
      } else {
        const newResp = await pool.connection.newSession(this.buildNewSessionRequest(path));
        acpSessionId = newResp.sessionId;
      }

      conv.acpSessionId = acpSessionId;
      pool.sessionToConversation.set(acpSessionId, conversationId);
      this.conversationIndex.set(conversationId, { poolKey, acpSessionId });

      void this.deps.setProviderSessionId(conversationId, acpSessionId).catch(() => {});

      if (conv.pendingModel) {
        await this.applyModelInternal(pool.connection, acpSessionId, conv.pendingModel, conv);
      }

      conv.lifecycle = 'ready';
      this.emitState(conv);

      if (initialPrompt?.trim()) {
        await this.sendPromptInternal(pool, conv, initialPrompt);
      }
    } catch (err) {
      this.deps.log.error('AcpSessionManager: failed to initialize ACP conversation', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
      for (const [sessionId, cId] of pool.sessionToConversation) {
        if (cId === conversationId) {
          pool.sessionToConversation.delete(sessionId);
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
      this.deps.log.warn('AcpSessionManager: cancel failed', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  resolvePermission(conversationId: string, requestId: string, optionId: string | null): void {
    const conv = this.resolveConv(conversationId);
    const resolver = this.permissionResolvers.get(requestId);

    if (!resolver) {
      this.deps.log.warn('AcpSessionManager: resolvePermission for unknown requestId', {
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

    this.deps.events.emit(acpPermissionResolvedChannel, { conversationId, requestId });
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
    }

    if (conv) {
      this.deps.events.emit(agentSessionExitedChannel, {
        conversationId: conv.conversationId,
        taskId: conv.taskId,
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

    void this.deps.updateConversationModel(conversationId, model).catch((err) => {
      this.deps.log.warn('AcpSessionManager: failed to persist model selection', {
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

  // -------------------------------------------------------------------------
  // Pool management
  // -------------------------------------------------------------------------

  private async getOrCreatePool(
    poolKey: string,
    providerId: string,
    workspaceId: string,
    path: string,
    plugin: ReturnType<typeof getPlugin>
  ): Promise<AcpPool> {
    const existing = this.pools.get(poolKey);
    if (existing) return existing;

    if (!plugin.behavior?.acp) {
      throw new Error(`AcpSessionManager: plugin '${providerId}' has no acp behavior`);
    }

    const { cli, agentEnv } = await this.deps.resolveSpawnContext(providerId, plugin);

    const { command, args, env } = plugin.behavior.acp.buildSpawn({
      cwd: path,
      env: agentEnv,
      cli,
    });

    const child = this.deps.spawn(command, args, {
      cwd: path,
      env: { ...agentEnv, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (child.stdin === null || child.stdout === null) {
      throw new Error('AcpSessionManager: failed to spawn ACP child process (no stdio)');
    }

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        this.deps.log.debug('AcpSessionManager: agent stderr', {
          poolKey,
          text: data.toString().trim(),
        });
      });
    }

    const pool: AcpPool = {
      child,
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

    pool.connection = plugin.behavior.acp.connect(
      { stdin: child.stdin, stdout: child.stdout },
      (_agent) => this.buildClientHandler(pool)
    );

    this.pools.set(poolKey, pool);

    child.on('exit', () => {
      this.handlePoolClosed(pool);
    });

    child.on('error', (err) => {
      this.deps.log.error('AcpSessionManager: child process error', {
        poolKey,
        error: err.message,
      });
      this.handlePoolClosed(pool);
    });

    const initReq: InitializeRequest = {
      protocolVersion: 1,
      clientInfo: { name: 'emdash', version: '1' },
    };

    pool.initialized = pool.connection
      .initialize(initReq)
      .then((_resp: InitializeResponse) => {
        this.deps.log.debug('AcpSessionManager: pool initialized', { poolKey });
      })
      .catch((err) => {
        this.deps.log.error('AcpSessionManager: pool initialize failed', {
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
      pool.child.kill('SIGTERM');
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

    const exitCode = pool.child.exitCode;

    for (const conv of pool.conversations.values()) {
      this.conversationIndex.delete(conv.conversationId);

      if (conv.activeTurnId) {
        this.closeTurnInternal(conv, 'error');
      }

      this.drainPendingPermissions(conv);

      conv.lifecycle = 'closed';
      this.emitState(conv);

      this.deps.events.emit(acpSessionClosedChannel, {
        conversationId: conv.conversationId,
        exitCode,
      });
      this.deps.events.emit(agentSessionExitedChannel, {
        conversationId: conv.conversationId,
        taskId: conv.taskId,
      });
    }

    this.deps.log.debug('AcpSessionManager: pool closed', {
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
          this.deps.log.warn('AcpSessionManager: sessionUpdate for unknown sessionId', {
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
        this.deps.events.emit(acpSessionUpdateChannel, {
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
          this.deps.log.warn('AcpSessionManager: requestPermission for unknown session', {
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

        this.deps.log.debug('AcpSessionManager: requesting user permission', {
          conversationId,
          requestId,
          title: payload.title,
        });

        this.deps.events.emit(acpPermissionRequestChannel, payload);

        return new Promise<RequestPermissionResponse>((resolve) => {
          this.permissionResolvers.set(requestId, resolve);
        });
      },

      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        try {
          const content = await this.deps.fs.readFile(params.path, 'utf8');
          return { content };
        } catch (err) {
          throw new Error(
            `readTextFile failed for ${params.path}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      },

      writeTextFile: async (params: WriteTextFileRequest): Promise<WriteTextFileResponse> => {
        await this.deps.fs.mkdir(dirname(params.path), { recursive: true });
        await this.deps.fs.writeFile(params.path, params.content, 'utf8');
        return {};
      },
    };
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
    this.deps.events.emit(acpTurnCommittedChannel, {
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
    this.deps.events.emit(acpSessionStateChannel, {
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
      this.deps.events.emit(acpPermissionResolvedChannel, {
        conversationId: conv.conversationId,
        requestId: pending.requestId,
      });
    }
    conv.pendingPermissions = [];
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
      throw new Error(`AcpSessionManager: no active session for conversation ${conversationId}`);
    }
    const pool = this.pools.get(entry.poolKey);
    const conv = pool?.conversations.get(conversationId);
    if (!pool || !conv) {
      throw new Error(`AcpSessionManager: pool not found for conversation ${conversationId}`);
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
      this.deps.log.error('AcpSessionManager: prompt error', {
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
      this.deps.log.warn('AcpSessionManager: failed to apply model selection', {
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

  private emitAgentEventInternal(conv: AcpConversation, type: AgentEvent['type']): void {
    const event: AgentEvent = {
      type,
      source: 'hook',
      providerId: conv.providerId,
      projectId: conv.projectId,
      taskId: conv.taskId,
      conversationId: conv.conversationId,
      timestamp: Date.now(),
      payload: {},
    };
    this.deps.emitAgentEvent(event);
  }
}
