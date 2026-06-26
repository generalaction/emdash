import { dirname } from 'node:path';
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
  ReadTextFileRequest,
  ReadTextFileResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
  SetSessionConfigOptionRequest,
  SetSessionModeRequest,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
} from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import { ok, toSerializedError } from '@emdash/shared';
import type { AcpAgentApi, IAcpBehavior } from '../agents/plugins/capabilities/acp';
import type { AgentUpdate } from './agent-update';
import { toAgentUpdate } from './agent-update';
import type { AcpRuntimeError } from './errors';
import { acpErr } from './errors';
import { ManagedAgentTerminal } from './managed-agent-terminal';
import type { AcpPermissionRequest } from './permissions';
import type { AcpSessionRuntimeDeps, AcpStartInput, IAcpSessionRuntime } from './runtime';
import type { Command, DomainEvent, Effect, SessionMachineState } from './session-machine';
import {
  activeTurnFromPhase,
  decide,
  evolve,
  initialMachineState,
  phaseToLifecycle,
} from './session-machine';
import type { TerminalSnapshot } from './terminals';
import type { AcpProcessHandle, AcpProcessHost } from './transport';
import type { AcpPromptImage, ChatHistory, SessionState } from './turns';

// ---------------------------------------------------------------------------
// AcpConversation — per-conversation state held inside a pool
// ---------------------------------------------------------------------------

interface AcpConversation {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: string;
  /** ACP-native session id assigned by newSession / loadSession. */
  acpSessionId: string | null;
  /** Pure state machine — owns lifecycle, turns, permissions, and metadata. */
  machine: SessionMachineState;
  /** Active terminals managed by this conversation. */
  terminals: Map<string, ManagedAgentTerminal>;
}

// ---------------------------------------------------------------------------
// AcpPool — one child process + connection shared by all conversations
// in a (provider, workspace) pair.  poolKey = `${providerId}:${workspaceId}`.
// ---------------------------------------------------------------------------

interface AcpPool {
  handle: AcpProcessHandle;
  host: AcpProcessHost;
  connection: AcpAgentApi;
  /**
   * Converts a raw ACP `SessionUpdate` into an `AgentUpdate`.
   * Composed of the baseline `toAgentUpdate` plus the optional provider `enrich` hook.
   */
  normalize: (raw: SessionUpdate) => AgentUpdate;
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
  /** Whether the agent advertised loadSession support during initialize. */
  supportsLoadSession: boolean;
  stopped: boolean;
}

// ---------------------------------------------------------------------------
// AcpSessionRuntime
// ---------------------------------------------------------------------------

/**
 * Machine-agnostic ACP session engine.
 *
 * Manages a pool-per-(provider,workspace) within a single machine. All public
 * methods return Result<void, AcpRuntimeError> and never throw. State
 * transitions are handled by the pure `decide`/`evolve` functions in
 * session-machine.ts; the runtime's job is to interpret the resulting effects
 * (listener calls, permission resolver answers, etc.).
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
  // Public API — all effectful methods return Result, never throw
  // -------------------------------------------------------------------------

  async start(input: AcpStartInput): Promise<Result<void, AcpRuntimeError>> {
    const { conversationId, providerId, workspaceId, cwd, sessionId, model, initialPrompt } = input;

    if (this.conversationIndex.has(conversationId)) {
      this.deps.log.debug('AcpSessionRuntime: conversation already running', { conversationId });
      const conv = this.resolveConv(conversationId);
      if (conv) this.applyEvent(conv, { type: 'state' } as unknown as DomainEvent);
      return ok();
    }

    const binding = this.deps.resolveAcp(providerId);
    if (!binding) {
      return acpErr.providerUnsupported(providerId);
    }

    // Reserve a slot synchronously before the first await so concurrent start()
    // calls cannot both proceed past the has() guard above.
    const poolKey = `${providerId}:${workspaceId}`;
    this.conversationIndex.set(conversationId, { poolKey, acpSessionId: null });

    let pool: AcpPool;
    try {
      pool = await this.getOrCreatePool(poolKey, providerId, workspaceId, cwd, binding);
    } catch (e) {
      this.conversationIndex.delete(conversationId);
      return acpErr.spawnFailed(toSerializedError(e));
    }

    if (pool.initialized) {
      try {
        await pool.initialized;
      } catch (e) {
        this.conversationIndex.delete(conversationId);
        return acpErr.initializeFailed(toSerializedError(e));
      }
    }

    const conv: AcpConversation = {
      conversationId,
      projectId: input.projectId,
      taskId: input.taskId,
      providerId,
      acpSessionId: sessionId,
      machine: initialMachineState(conversationId),
      terminals: new Map(),
    };

    pool.conversations.set(conversationId, conv);
    this.conversationIndex.set(conversationId, { poolKey, acpSessionId: conv.acpSessionId });

    // Emit initial 'starting' state
    this.emitStateEffect(conv);

    try {
      // Assigned in all success paths; TypeScript needs the initializer for control flow
      let acpSessionId = '';

      if (conv.acpSessionId && pool.supportsLoadSession && pool.connection.loadSession) {
        const originalSessionId = conv.acpSessionId;
        pool.sessionToConversation.set(originalSessionId, conversationId);
        pool.loadingConversations.add(conversationId);

        // Open replay turn
        this.applyEvent(conv, { type: 'ReplayStarted' });

        let loadedSuccessfully = false;
        try {
          const resp = await pool.connection.loadSession!(
            this.buildLoadSessionRequest(cwd, originalSessionId)
          );
          pool.loadingConversations.delete(conversationId);
          // Seed metadata from loadSession response
          if (resp.modes !== undefined || resp.configOptions !== undefined) {
            this.applyEvent(conv, {
              type: 'SessionLoaded',
              modes: resp.modes,
              configOptions: resp.configOptions,
            });
          }
          this.applyEvent(conv, { type: 'ReplayEnded', status: 'complete' });
          acpSessionId = conv.acpSessionId!;
          if (acpSessionId !== originalSessionId) {
            pool.sessionToConversation.delete(originalSessionId);
          }
          loadedSuccessfully = true;
        } catch {
          pool.loadingConversations.delete(conversationId);
        }

        if (!loadedSuccessfully) {
          this.deps.log.warn('AcpSessionRuntime: loadSession failed, starting new session', {
            conversationId,
          });
          // Commit the replay turn as 'complete' even on failure: the session continues
          // with a fresh newSession, so the empty replay turn is not an error from the
          // user's perspective.
          this.applyEvent(conv, { type: 'ReplayEnded', status: 'complete' });
          pool.sessionToConversation.delete(originalSessionId);
          if (conv.acpSessionId !== originalSessionId) {
            pool.sessionToConversation.delete(conv.acpSessionId!);
          }

          try {
            const newResp = await pool.connection.newSession(this.buildNewSessionRequest(cwd));
            acpSessionId = newResp.sessionId;
            this.applyEvent(conv, {
              type: 'SessionReady',
              modes: newResp.modes,
              configOptions: newResp.configOptions,
            });
          } catch (e) {
            this.cleanupFailedConversation(pool, conv);
            return acpErr.newSessionFailed(toSerializedError(e));
          }
        }
      } else {
        // No existing session id, or loadSession not supported — start fresh
        try {
          const newResp = await pool.connection.newSession(this.buildNewSessionRequest(cwd));
          acpSessionId = newResp.sessionId;
          this.applyEvent(conv, {
            type: 'SessionReady',
            modes: newResp.modes,
            configOptions: newResp.configOptions,
          });
        } catch (e) {
          this.cleanupFailedConversation(pool, conv);
          return acpErr.newSessionFailed(toSerializedError(e));
        }
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

      // Apply pending model from persisted config as a setSessionConfigOption call
      if (model && pool.connection.setSessionConfigOption) {
        await this.applyConfigOptionInternal(pool.connection, acpSessionId, 'model', model, conv);
      }

      if (initialPrompt?.trim()) {
        const promptResult = await this.sendPromptInternal(pool, conv, initialPrompt);
        if (!promptResult.success) {
          this.deps.log.warn('AcpSessionRuntime: initial prompt failed', {
            conversationId,
            error: promptResult.error.type,
          });
        }
      }

      return ok();
    } catch (err) {
      this.deps.log.error('AcpSessionRuntime: unexpected error during start', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.cleanupFailedConversation(pool, conv);
      return acpErr.initializeFailed(toSerializedError(err));
    }
  }

  async prompt(
    conversationId: string,
    text: string,
    images?: AcpPromptImage[]
  ): Promise<Result<void, AcpRuntimeError>> {
    const conv = this.resolveConv(conversationId);
    if (!conv) return acpErr.conversationNotFound(conversationId);
    const entry = this.conversationIndex.get(conversationId);
    if (!entry?.acpSessionId) return acpErr.noActiveSession(conversationId);
    const pool = this.pools.get(entry.poolKey);
    if (!pool) return acpErr.noActiveSession(conversationId);
    return this.sendPromptInternal(pool, conv, text, images);
  }

  async cancel(conversationId: string): Promise<Result<void, AcpRuntimeError>> {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry?.acpSessionId) return ok();
    const pool = this.pools.get(entry.poolKey);
    if (!pool) return ok();
    const conv = pool.conversations.get(conversationId);
    if (!conv) return ok();

    // Dispatch Cancel command — drains permissions, flips to cancelling
    const dispatchResult = this.dispatch(conv, { type: 'Cancel' });
    if (!dispatchResult.success) return dispatchResult;

    try {
      await pool.connection.cancel({ sessionId: entry.acpSessionId! });
    } catch (e) {
      const err = acpErr.cancelFailed(toSerializedError(e));
      this.deps.log.warn('AcpSessionRuntime: cancel failed', {
        conversationId,
        error: err.error.type,
      });
      return err;
    }
    return ok();
  }

  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string | null
  ): Result<void, AcpRuntimeError> {
    const conv = this.resolveConv(conversationId);
    if (!conv) return acpErr.conversationNotFound(conversationId);

    const resolver = this.permissionResolvers.get(requestId);
    if (!resolver) {
      this.deps.log.warn('AcpSessionRuntime: resolvePermission for unknown requestId', {
        conversationId,
        requestId,
      });
      return acpErr.invalidState(`No resolver for requestId '${requestId}'`);
    }

    // Validate via dispatch first
    const dispatchResult = this.dispatch(conv, {
      type: 'ResolvePermission',
      requestId,
      optionId,
    });
    if (!dispatchResult.success) return dispatchResult;

    // Answer the non-serializable resolver callback.
    // The effect interpreter already calls onPermissionResolved for cancelled drains;
    // for user-initiated resolutions we call the resolver directly here and the
    // effect from dispatch() handles the listener notification.
    this.permissionResolvers.delete(requestId);
    resolver(
      optionId
        ? { outcome: { outcome: 'selected', optionId } }
        : { outcome: { outcome: 'cancelled' } }
    );
    return ok();
  }

  stop(conversationId: string): Result<void, AcpRuntimeError> {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry) return ok();
    const pool = this.pools.get(entry.poolKey);
    if (!pool) {
      this.conversationIndex.delete(conversationId);
      return ok();
    }
    const conv = pool.conversations.get(conversationId);

    if (conv?.acpSessionId && pool.connection.closeSession) {
      void pool.connection.closeSession({ sessionId: conv.acpSessionId }).catch(() => {});
      pool.sessionToConversation.delete(conv.acpSessionId);
    }

    pool.conversations.delete(conversationId);
    this.conversationIndex.delete(conversationId);

    if (conv) {
      this.drainPermissionResolvers(conv);
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
    return ok();
  }

  async setModel(conversationId: string, model: string): Promise<Result<void, AcpRuntimeError>> {
    const entry = this.conversationIndex.get(conversationId);
    const pool = entry ? this.pools.get(entry.poolKey) : undefined;
    const conv = pool ? pool.conversations.get(conversationId) : undefined;

    if (pool && conv && entry?.acpSessionId && pool.connection.setSessionConfigOption) {
      const result = await this.applyConfigOptionInternal(
        pool.connection,
        entry.acpSessionId,
        'model',
        model,
        conv
      );
      if (!result.success) return result;
    }

    void this.deps.persistModel(conversationId, model).catch((err) => {
      this.deps.log.warn('AcpSessionRuntime: failed to persist model selection', {
        conversationId,
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    return ok();
  }

  async setMode(conversationId: string, modeId: string): Promise<Result<void, AcpRuntimeError>> {
    const entry = this.conversationIndex.get(conversationId);
    const pool = entry ? this.pools.get(entry.poolKey) : undefined;
    const conv = pool ? pool.conversations.get(conversationId) : undefined;

    if (!conv) return acpErr.conversationNotFound(conversationId);
    if (!entry?.acpSessionId) return acpErr.noActiveSession(conversationId);
    if (!pool) return acpErr.noActiveSession(conversationId);

    // Validate the mode exists
    const decideResult = this.dispatch(conv, { type: 'SetMode', modeId });
    if (!decideResult.success) return decideResult;

    if (!pool.connection.setSessionMode) {
      return acpErr.setModeFailed({
        name: 'Error',
        message: 'Agent connection does not support setSessionMode',
      });
    }

    const req: SetSessionModeRequest = {
      sessionId: entry.acpSessionId,
      modeId,
    };
    try {
      await pool.connection.setSessionMode(req);
    } catch (e) {
      return acpErr.setModeFailed(toSerializedError(e));
    }

    // The mode change will come through as a current_mode_update notification.
    // No need to update machine state here — the notification is authoritative.
    return ok();
  }

  isRunning(conversationId: string): boolean {
    return this.conversationIndex.has(conversationId);
  }

  getChatHistory(conversationId: string): ChatHistory {
    const conv = this.resolveConv(conversationId);
    if (!conv) return { turns: [], complete: true };
    const { machine } = conv;
    return {
      turns: machine.committedTurns.map((t) => structuredClone(t)),
      complete: machine.phase.kind !== 'starting' && machine.phase.kind !== 'replaying',
    };
  }

  getSessionState(conversationId: string): SessionState {
    const conv = this.resolveConv(conversationId);
    if (!conv) {
      return {
        lifecycle: 'closed',
        activeTurn: null,
        pendingPermissions: [],
        modes: null,
        configOptions: [],
        availableCommands: [],
        lastStopReason: null,
      };
    }
    const { machine } = conv;
    const activeTurn = activeTurnFromPhase(machine.phase);
    return {
      lifecycle: phaseToLifecycle(machine.phase),
      activeTurn: activeTurn ? structuredClone(activeTurn) : null,
      pendingPermissions: structuredClone([...machine.pendingPermissions]),
      modes: machine.modes ? structuredClone(machine.modes) : null,
      configOptions: structuredClone([...machine.configOptions]),
      availableCommands: structuredClone([...machine.availableCommands]),
      lastStopReason: machine.lastStopReason,
    };
  }

  getTerminals(conversationId: string): TerminalSnapshot[] {
    const conv = this.resolveConv(conversationId);
    if (!conv) return [];
    return Array.from(conv.terminals.values()).map((t) => t.snapshot());
  }

  // -------------------------------------------------------------------------
  // State machine integration
  // -------------------------------------------------------------------------

  /**
   * Validate a command and, if valid, apply the resulting events to `conv`.
   * Returns the decision result (success = all events applied, error = rejected).
   */
  private dispatch(conv: AcpConversation, command: Command): Result<void, AcpRuntimeError> {
    const decision = decide(conv.machine, command);
    if (!decision.success) return decision;
    for (const event of decision.data) {
      this.applyEventToMachine(conv, event);
    }
    return ok();
  }

  /**
   * Feed a DomainEvent into the machine and interpret all resulting effects.
   * Always succeeds — facts are unconditionally folded.
   */
  private applyEvent(conv: AcpConversation, event: DomainEvent): void {
    this.applyEventToMachine(conv, event);
  }

  private applyEventToMachine(conv: AcpConversation, event: DomainEvent): void {
    const { state, effects } = evolve(conv.machine, event);
    conv.machine = state;
    for (const effect of effects) {
      this.interpretEffect(conv, effect);
    }
  }

  private interpretEffect(conv: AcpConversation, effect: Effect): void {
    try {
      switch (effect.type) {
        case 'state':
          this.emitStateEffect(conv);
          break;

        case 'update':
          this.deps.listener.onSessionUpdate({
            conversationId: conv.conversationId,
            turnId: effect.turnId,
            update: effect.update,
            seq: effect.seq,
          });
          break;

        case 'turnCommitted':
          this.deps.listener.onTurnCommitted({
            conversationId: conv.conversationId,
            turn: structuredClone(effect.turn),
          });
          break;

        case 'permissionRequest':
          this.deps.listener.onPermissionRequest(effect.request);
          break;

        case 'permissionResolved': {
          if (effect.cancelled) {
            // Drain the resolver when cancelled by the machine (cancel/poolClose)
            const resolver = this.permissionResolvers.get(effect.requestId);
            if (resolver) {
              this.permissionResolvers.delete(effect.requestId);
              resolver({ outcome: { outcome: 'cancelled' } });
            }
          }
          this.deps.listener.onPermissionResolved({
            conversationId: conv.conversationId,
            requestId: effect.requestId,
          });
          break;
        }

        case 'meta':
          this.deps.listener.onSessionMeta({ conversationId: conv.conversationId });
          break;

        case 'closed':
          this.deps.listener.onClosed({
            conversationId: conv.conversationId,
            taskId: conv.taskId,
            exitCode: effect.exitCode,
          });
          break;

        case 'agentEvent':
          this.deps.listener.onAgentEvent({
            type: effect.phase,
            conversationId: conv.conversationId,
            projectId: conv.projectId,
            taskId: conv.taskId,
            providerId: conv.providerId,
          });
          break;

        case 'warn':
          this.deps.log.warn(`AcpSessionRuntime: ${effect.message}`, {
            conversationId: conv.conversationId,
          });
          break;
      }
    } catch (err) {
      this.deps.log.error('AcpSessionRuntime: effect interpreter caught listener error', {
        conversationId: conv.conversationId,
        effectType: effect.type,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private emitStateEffect(conv: AcpConversation): void {
    const activeTurn = activeTurnFromPhase(conv.machine.phase);
    this.deps.listener.onState({
      conversationId: conv.conversationId,
      lifecycle: phaseToLifecycle(conv.machine.phase),
      activeTurnId: activeTurn?.id ?? null,
    });
  }

  // -------------------------------------------------------------------------
  // Pool management
  // -------------------------------------------------------------------------

  private async getOrCreatePool(
    poolKey: string,
    providerId: string,
    workspaceId: string,
    path: string,
    binding: { behavior: IAcpBehavior }
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
      normalize: binding.behavior.enrich
        ? (raw) => binding.behavior.enrich!(toAgentUpdate(raw), raw)
        : (raw) => toAgentUpdate(raw),
      providerId,
      workspaceId,
      path,
      conversations: new Map(),
      sessionToConversation: new Map(),
      loadingConversations: new Set(),
      initialized: null,
      supportsLoadSession: false,
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
      .then((resp: InitializeResponse) => {
        pool.supportsLoadSession = resp.agentCapabilities?.loadSession === true;
        this.deps.log.debug('AcpSessionRuntime: pool initialized', {
          poolKey,
          supportsLoadSession: pool.supportsLoadSession,
        });
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
      this.applyEvent(conv, { type: 'PoolClosed', exitCode });
      this.disposeTerminals(conv);
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

        const rawUpdate = params.update;

        // Route metadata notifications as MetaChanged facts before turn routing
        switch (rawUpdate.sessionUpdate) {
          case 'current_mode_update': {
            const currentModeId = rawUpdate.currentModeId;
            const currentModes = conv.machine.modes;
            if (currentModes) {
              this.applyEvent(conv, {
                type: 'MetaChanged',
                modes: { ...currentModes, currentModeId },
              });
            }
            return;
          }

          case 'config_option_update': {
            this.applyEvent(conv, {
              type: 'MetaChanged',
              configOptions: rawUpdate.configOptions,
            });
            return;
          }

          case 'available_commands_update': {
            this.applyEvent(conv, {
              type: 'MetaChanged',
              availableCommands: rawUpdate.availableCommands,
            });
            return;
          }

          default:
            break;
        }

        // Route as a turn update — machine will warn if no active turn
        const update = pool.normalize(rawUpdate);
        this.applyEvent(conv, { type: 'Updated', update });
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

        this.deps.log.debug('AcpSessionRuntime: requesting user permission', {
          conversationId,
          requestId,
          title: payload.title,
        });

        this.applyEvent(conv, { type: 'PermissionRequested', request: payload });

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

        const terminal = new ManagedAgentTerminal(
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

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

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

  private resolveConv(conversationId: string): AcpConversation | null {
    const entry = this.conversationIndex.get(conversationId);
    if (!entry) return null;
    const pool = this.pools.get(entry.poolKey);
    return pool?.conversations.get(conversationId) ?? null;
  }

  private async sendPromptInternal(
    pool: AcpPool,
    conv: AcpConversation,
    text: string,
    images?: AcpPromptImage[]
  ): Promise<Result<void, AcpRuntimeError>> {
    if (!conv.acpSessionId) return acpErr.noActiveSession(conv.conversationId);

    // Synthesize user message update
    const userUpdate: AgentUpdate = {
      kind: 'message',
      role: 'user',
      messageId: `${conv.conversationId}-${conv.machine.nextTurnIndex}-user`,
      text,
    };

    const dispatchResult = this.dispatch(conv, { type: 'Prompt', userUpdate });
    if (!dispatchResult.success) return dispatchResult;

    try {
      const res = await pool.connection.prompt({
        sessionId: conv.acpSessionId!,
        prompt: [
          ...(images ?? []).map((img) => ({
            type: 'image' as const,
            data: img.data,
            mimeType: img.mimeType,
          })),
          ...(text ? [{ type: 'text' as const, text }] : []),
        ],
      });
      this.applyEvent(conv, {
        type: 'TurnEnded',
        outcome: { kind: 'stopped', stopReason: res.stopReason },
      });
      return ok();
    } catch (e) {
      const errResult = acpErr.promptFailed(toSerializedError(e));
      this.deps.log.error('AcpSessionRuntime: prompt error', {
        conversationId: conv.conversationId,
        error: errResult.error.type,
      });
      this.applyEvent(conv, { type: 'TurnEnded', outcome: { kind: 'errored' } });
      return errResult;
    }
  }

  private async applyConfigOptionInternal(
    connection: AcpAgentApi,
    acpSessionId: string,
    configId: string,
    value: string,
    conv: AcpConversation
  ): Promise<Result<void, AcpRuntimeError>> {
    if (!connection.setSessionConfigOption) return ok();
    const req: SetSessionConfigOptionRequest = { sessionId: acpSessionId, configId, value };
    try {
      const resp = await connection.setSessionConfigOption(req);
      this.applyEvent(conv, {
        type: 'MetaChanged',
        configOptions: resp.configOptions,
      });
      return ok();
    } catch (e) {
      const errResult = acpErr.setConfigFailed(toSerializedError(e));
      this.deps.log.warn('AcpSessionRuntime: failed to apply config option', {
        conversationId: conv.conversationId,
        configId,
        error: errResult.error.type,
      });
      return errResult;
    }
  }

  private buildNewSessionRequest(cwd: string): NewSessionRequest {
    return { cwd, mcpServers: [] };
  }

  private buildLoadSessionRequest(cwd: string, sessionId: string): LoadSessionRequest {
    return { sessionId, cwd, mcpServers: [] };
  }

  private cleanupFailedConversation(pool: AcpPool, conv: AcpConversation): void {
    for (const [sid, cId] of pool.sessionToConversation) {
      if (cId === conv.conversationId) {
        pool.sessionToConversation.delete(sid);
      }
    }
    pool.conversations.delete(conv.conversationId);
    this.conversationIndex.delete(conv.conversationId);
    if (pool.conversations.size === 0) {
      this.destroyPool(pool);
    }
  }

  private drainPermissionResolvers(conv: AcpConversation): void {
    for (const pending of conv.machine.pendingPermissions) {
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
}
