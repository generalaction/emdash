import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  LoadSessionRequest,
  NewSessionRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import type { Lease, Result, Serializable } from '@emdash/shared';
import { ok, toSerializedError } from '@emdash/shared';
import {
  acquireResourceAsResult,
  createLifecycleRegistry,
  type LifecycleRegistry,
  type LifecycleRegistryStateChange,
  type Scope,
} from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { produce } from '@emdash/wire/state';
import type {
  AcpCancelTurnError,
  AcpActivationError,
  AcpChangeQueuePromptOrderError,
  AcpDeleteQueuedPromptError,
  AcpEditQueuedPromptError,
  AcpExportRawLogError,
  AcpExportTranscriptError,
  AcpKillError,
  AcpResolvePermissionError,
  AcpSendPromptError,
  AcpSetModeOptionError,
  AcpSetModelOptionError,
  AcpStartError,
  InvalidStateError,
  NormalizedEvent,
  SessionMcpServer,
  SessionState,
  SessionSummary,
  StaleActivationError,
  TerminalState,
  TranscriptTurn,
} from '#runtimes/acp/api';
import { acpErr, acpStartInputSchema, initialSessionConfigState } from '#runtimes/acp/api';
import type { InboundRouter } from '#runtimes/acp/node/agent-ports/agent-client';
import type { FsPort } from '#runtimes/acp/node/agent-ports/fs-port';
import type { AgentTerminalManager } from '#runtimes/acp/node/agent-ports/terminal-manager';
import type { TerminalPort } from '#runtimes/acp/node/agent-ports/terminal-port';
import {
  isAcpConnectionError,
  type AcpConnectionEntry,
  type AcpConnectionContext,
  type AcpConnectionKey,
  type AcpConnectionSource,
  type PooledAcpProcess,
} from '#runtimes/acp/node/connection/source';
import { SessionCell, type AcpChatHistory } from '#runtimes/acp/node/session/cell';
import type { SessionCellCallbacks } from '#runtimes/acp/node/session/cell-deps';
import {
  createAcpSessionLiveHost,
  createAcpSessionsLiveHost,
  createSessionsListModel,
  inactiveSessionState,
  type ActivationSnapshot,
  type AcpSessionLiveHost,
  type AcpSessionsLiveHost,
  type SessionLiveModels,
  type SessionsListModel,
} from '#runtimes/acp/node/state/live-models';
import type {
  ActivityFields,
  ConversationSessionLifecycle,
  EvictOptions,
  SessionSnapshotJudgment,
} from '#services/session-lifecycle/api';
import { createSessionLifecycle } from '#services/session-lifecycle/node';
import { registrationsToAcpMcpServers, summarizeAcpMcpServers } from './mcp-servers';
import type { AcpRuntimeDeps, AcpStartInput, SendPromptInput } from './types';

interface SessionRecord {
  activationId: string;
  resumeOutcome: 'loaded' | 'replaced-by-new' | null;
  input: AcpStartInput;
  processKey: string;
  processGeneration: number;
  connectionLease: Lease<PooledAcpProcess>;
  /**
   * Cleared before evicting a record whose pooled process already died: the pool
   * entry is invalidated instead, so the evict step must not release the lease.
   */
  releaseLeaseOnEvict: boolean;
  cell: SessionCell;
  projection: SessionLiveModels;
  mcpServers: SessionMcpServer[];
  machineStateBinding: { dispose(): void };
  disposed: boolean;
}

type ActivationRegistry = LifecycleRegistry<
  AcpStartInput,
  SessionRecord,
  AcpStartError,
  void,
  never
>;

export interface HistoryPage {
  turns: TranscriptTurn[];
  nextCursor: number | null;
}

export class SessionManager implements InboundRouter {
  readonly sessionHost: AcpSessionLiveHost = createAcpSessionLiveHost();
  readonly sessionsHost: AcpSessionsLiveHost = createAcpSessionsLiveHost();
  readonly sessionsList: SessionsListModel = createSessionsListModel(this.sessionsHost);
  private readonly activations: ActivationRegistry;
  private readonly materializing = new Map<string, SessionRecord>();
  private readonly evictions = new Map<string, Promise<void>>();
  private readonly routes = new Map<string, Map<string, string>>();
  private readonly loadingConversations = new Map<string, Set<string>>();
  private readonly clock: Clock;
  private readonly lifecycle: ConversationSessionLifecycle;

  constructor(
    private readonly deps: AcpRuntimeDeps & { logger: Logger },
    private readonly connections: AcpConnectionSource,
    private readonly terminals: AgentTerminalManager,
    private readonly ports: { fs: FsPort; terminals: TerminalPort }
  ) {
    this.clock = deps.clock ?? systemClock;
    this.activations = createLifecycleRegistry<
      AcpStartInput,
      SessionRecord,
      AcpStartError,
      void,
      never
    >({
      label: 'acp-session-activations',
      keyOf: (input) => input.conversationId,
      start: (input, scope) => this.startActivation(input, scope),
      stop: async (_key, record) => {
        await record.cell.closeSession().catch(() => {});
        return ok();
      },
      onStateChanged: (change) => this.onActivationStateChanged(change),
      onObserverError: ({ key, error }) => {
        this.deps.logger.warn('SessionManager: activation state observer failed', {
          conversationId: key,
          error: String(error),
        });
      },
    });
    this.lifecycle = createSessionLifecycle<AcpStartInput, void>({
      name: 'SessionManager',
      logger: deps.logger,
      clock: this.clock,
      idlePolicy: deps.lifecycle?.session,
      sweepIntervalMs: deps.lifecycle?.sweepIntervalMs,
      entries: () => this.activations.keys(),
      snapshot: (conversationId) => this.lifecycleSnapshot(conversationId),
      syncListEntry: (conversationId, activity) =>
        this.syncSessionActivity(conversationId, activity),
      deactivate: async (conversationId, cause) => {
        await this.stop(conversationId, cause);
      },
      evictSteps: [
        { name: 'activation', run: (key) => this.activations.stop(key) },
        { name: 'sessions-list-summary', run: (key) => this.deleteSessionSummary(key) },
      ],
      conversation: {
        intents: deps.intents,
        reports: deps.conversationReports,
        activePayload: (conversationId) => {
          const record = this.activations.get(conversationId);
          if (!record) return null;
          const { initialQueue: _initialQueue, ...persisted } = record.input;
          const sessionId = record.cell.acpSessionId;
          return { payload: { ...persisted, sessionId } as unknown as Serializable, sessionId };
        },
        reconcile: {
          parse: (intent) => {
            const parsed = acpStartInputSchema.safeParse(intent.payload);
            const sessionId = intent.sessionId ?? (parsed.success ? parsed.data.sessionId : null);
            if (!parsed.success || !sessionId) return { suspend: 'reconcile-failed' };
            return { input: { ...parsed.data, sessionId, initialQueue: undefined } };
          },
          resume: (input) => this.start(input),
        },
      },
    });
  }

  async start(
    input: AcpStartInput
  ): Promise<Result<{ sessionId: string; activationId: string }, AcpStartError>> {
    await this.evictions.get(input.conversationId);
    this.lifecycle.recordInput(input.conversationId);
    const existing = this.activations.get(input.conversationId);

    const started = await this.activations.start(input);
    if (!started.success) {
      await this.evict(input.conversationId, { intent: 'keep' });
      return started;
    }
    if (existing === started.data) this.lifecycle.saveIntent(input.conversationId);
    return ok({
      sessionId: started.data.cell.acpSessionId,
      activationId: started.data.activationId,
    });
  }

  private async startActivation(
    input: AcpStartInput,
    scope: Scope
  ): Promise<Result<SessionRecord, AcpStartError>> {
    const activationId = crypto.randomUUID();
    const projection = this.sessionHost.models(input.conversationId);
    scope.add(this.sessionHost.models.retain(input.conversationId));
    projection.source.set({
      activationId,
      state: { ...inactiveSessionState, lifecycle: 'starting' },
      config: initialSessionConfigState,
      usage: null,
      plan: null,
      agents: [],
      activeTurn: null,
      terminals: [],
      mcpServers: [],
    });

    this.upsertSessionSummary(input, null, {
      lifecycle: 'starting',
      isGenerating: false,
      pendingPermissionCount: 0,
      backgroundAgentCount: 0,
      queuedPromptCount: 0,
    });

    const binding = this.deps.agentHost.resolveAcp(input.providerId);
    if (!binding) {
      return acpErr.providerUnsupported(input.providerId);
    }

    const connectionKey: AcpConnectionKey = {
      providerId: input.providerId,
      cwd: input.cwd,
      env: input.env,
    };
    const acquire = await acquireResourceAsResult(
      this.connections,
      connectionKey,
      isAcpConnectionError
    );
    if (!acquire.success) {
      return acquire;
    }

    const acquired = acquire.data;
    let recordOwnsLease = false;
    scope.add(async () => {
      if (!recordOwnsLease) await acquired.release();
    });
    const connection = acquired.value;
    const mcpServers = await this.resolveSessionMcpServers(input.providerId, connection);
    const mcpServerSummary = summarizeAcpMcpServers(mcpServers);
    let record: SessionRecord | null = null;
    // Resume outcome for the lifecycle report (spec §7.4): null when no resume was attempted
    // (fresh conversation); 'loaded' when the provider replayed the prior session;
    // 'replaced-by-new' when a prior session existed but could not be restored.
    let resumeOutcome: 'loaded' | 'replaced-by-new' | null = input.sessionId
      ? 'replaced-by-new'
      : null;

    try {
      if (input.sessionId && connection.supportsLoadSession && connection.agent.loadSession) {
        record = this.createRecord(
          input,
          connection,
          acquired,
          input.sessionId,
          activationId,
          projection,
          scope
        );
        recordOwnsLease = true;
        this.addLoading(connectionOwnerId(connection), input.conversationId);
        this.registerRoute(connectionOwnerId(connection), input.sessionId, input.conversationId);
        record.cell.beginReplay();

        let loaded = false;
        try {
          const response = await connection.agent.loadSession(
            this.buildLoadSessionRequest(input.cwd, input.sessionId, mcpServers)
          );
          record.cell.applySessionLoaded({
            modes: response.modes,
            configOptions: response.configOptions,
          });
          if (input.model) {
            const modelResult = await record.cell.setConfigOption('model', input.model);
            if (!modelResult.success) {
              this.deps.logger.warn('SessionManager: failed to apply initial model', {
                conversationId: input.conversationId,
                providerId: input.providerId,
                error: modelResult.error,
              });
            }
          }
          await this.applyInitialMode(record, input);
          const queueResult = this.queueInitialPrompts(record);
          if (!queueResult.success) return queueResult;
          record.cell.endReplay();
          loaded = true;
          resumeOutcome = 'loaded';
        } catch (e) {
          if (isAuthRequiredError(e)) throw e;
          this.deps.logger.warn('SessionManager: loadSession failed, starting a new session', {
            conversationId: input.conversationId,
          });
        } finally {
          this.removeLoading(connectionOwnerId(connection), input.conversationId);
        }

        if (!loaded) {
          this.discardReplacedRecord(record);
          record = null;
          recordOwnsLease = false;
        }
      }

      if (!record) {
        let response;
        try {
          response = await connection.agent.newSession(
            this.buildNewSessionRequest(input.cwd, mcpServers)
          );
        } catch (e) {
          if (isAuthRequiredError(e)) throw e;
          return acpErr.newSessionFailed(toSerializedError(e));
        }
        record = this.createRecord(
          input,
          connection,
          acquired,
          response.sessionId,
          activationId,
          projection,
          scope
        );
        recordOwnsLease = true;
        record.cell.applySessionMeta({
          modes: response.modes,
          configOptions: response.configOptions,
        });
        if (input.model) {
          const modelResult = await record.cell.setConfigOption('model', input.model);
          if (!modelResult.success) {
            this.deps.logger.warn('SessionManager: failed to apply initial model', {
              conversationId: input.conversationId,
              providerId: input.providerId,
              error: modelResult.error,
            });
          }
        }
        await this.applyInitialMode(record, input);
        const queueResult = this.queueInitialPrompts(record);
        if (!queueResult.success) return queueResult;
        record.cell.applySessionReady();
      }

      this.registerRoute(
        connectionOwnerId(connection),
        record.cell.acpSessionId,
        input.conversationId
      );

      record.mcpServers = mcpServerSummary;
      this.syncRecord(record);
      record.resumeOutcome = resumeOutcome;
      return ok(record);
    } catch (e) {
      if (isAuthRequiredError(e)) {
        return acpErr.authRequired(toSerializedError(e));
      }
      return acpErr.initializeFailed(toSerializedError(e));
    }
  }

  async prompt(
    input: SendPromptInput,
    activation?: AcpStartInput,
    expectedActivationId?: string
  ): Promise<Result<{ queued: boolean }, AcpSendPromptError>> {
    const target = this.resolveActivationTarget(
      input.conversationId,
      activation,
      expectedActivationId
    );
    if (!target.success) return target;
    const acquired = await this.activations.acquire(target.data);
    if (!acquired.success) return acquired;
    const lease = acquired.data;
    try {
      const fence = this.checkActivationFence(lease.value, expectedActivationId);
      if (!fence.success) return fence;
      this.lifecycle.recordInput(input.conversationId);
      if (input.placement === 'queue') {
        const state = lease.value.cell.sessionState;
        if (state.lifecycle !== 'ready' || state.isGenerating || state.queuedPrompts.length > 0) {
          const result = lease.value.cell.queuePrompt(input.prompt);
          if (!result.success) return result;
          return ok({ queued: true });
        }
      }
      return lease.value.cell.prompt(input.prompt);
    } finally {
      await lease.release();
    }
  }

  async editQueuedPrompt(
    conversationId: string,
    id: string,
    input: SendPromptInput['prompt'],
    activation?: AcpStartInput,
    expectedActivationId?: string
  ): Promise<Result<void, AcpEditQueuedPromptError>> {
    return this.useSerialized(conversationId, activation, expectedActivationId, (record) =>
      record.cell.editQueuedPrompt(id, input)
    );
  }

  async removeQueuedPrompt(
    conversationId: string,
    id: string,
    activation?: AcpStartInput,
    expectedActivationId?: string
  ): Promise<Result<void, AcpDeleteQueuedPromptError>> {
    return this.useSerialized(conversationId, activation, expectedActivationId, (record) =>
      record.cell.removeQueuedPrompt(id)
    );
  }

  async reorderQueue(
    conversationId: string,
    ids: readonly string[],
    activation?: AcpStartInput,
    expectedActivationId?: string
  ): Promise<Result<void, AcpChangeQueuePromptOrderError>> {
    return this.useSerialized(conversationId, activation, expectedActivationId, (record) =>
      record.cell.reorderQueue(ids)
    );
  }

  async cancel(conversationId: string): Promise<Result<void, AcpCancelTurnError>> {
    const record = this.recordFor(conversationId);
    if (!record) return ok();
    return record.cell.cancel();
  }

  async stop(conversationId: string, cause = 'user'): Promise<Result<void, AcpKillError>> {
    await this.evict(conversationId, { cause, intent: 'suspend' });
    return ok();
  }

  async kill(conversationId: string): Promise<Result<void, AcpKillError>> {
    await this.evict(conversationId, { cause: 'user', intent: 'remove' });
    return ok();
  }

  async resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string,
    activation?: AcpStartInput,
    expectedActivationId?: string
  ): Promise<Result<void, AcpResolvePermissionError>> {
    return this.useSerialized(conversationId, activation, expectedActivationId, (record) =>
      record.cell.resolvePermission(requestId, optionId)
    );
  }

  async setMode(
    conversationId: string,
    modeId: string,
    activation?: AcpStartInput,
    expectedActivationId?: string
  ): Promise<Result<void, AcpSetModeOptionError>> {
    return this.useSerialized(conversationId, activation, expectedActivationId, (record) =>
      record.cell.setMode(modeId)
    );
  }

  async setConfigOption(
    conversationId: string,
    dimension: 'model' | 'effort',
    value: string,
    activation?: AcpStartInput,
    expectedActivationId?: string
  ): Promise<Result<void, AcpSetModelOptionError>> {
    return this.useSerialized(conversationId, activation, expectedActivationId, (record) =>
      record.cell.setConfigOption(dimension, value)
    );
  }

  isRunning(conversationId: string): boolean {
    return this.activations.has(conversationId);
  }

  getChatHistory(conversationId: string): AcpChatHistory {
    return this.recordFor(conversationId)?.cell.history() ?? { committed: [], active: null };
  }

  exportParsedTranscript(
    conversationId: string,
    activation?: AcpStartInput,
    expectedActivationId?: string
  ): Promise<Result<string, AcpExportTranscriptError>> {
    return this.useSerialized(conversationId, activation, expectedActivationId, (record) =>
      ok(record.cell.exportParsedTranscript())
    );
  }

  exportRawAcpLog(
    conversationId: string,
    activation?: AcpStartInput,
    expectedActivationId?: string
  ): Promise<Result<string, AcpExportRawLogError>> {
    return this.useSerialized(conversationId, activation, expectedActivationId, (record) =>
      ok(record.cell.exportRawLog())
    );
  }

  getHistory(
    conversationId: string,
    before?: number,
    limit = 50,
    activation?: AcpStartInput,
    expectedActivationId?: string
  ): Promise<Result<HistoryPage, AcpExportTranscriptError>> {
    return this.useSerialized(conversationId, activation, expectedActivationId, (record) => {
      const turns = record.cell.history().committed;
      const filtered = before === undefined ? turns : turns.filter((turn) => turn.seq < before);
      const page = [...filtered].sort((a, b) => b.seq - a.seq).slice(0, limit);
      const nextCursor = page.length === limit ? page.at(-1)!.seq : null;
      return ok({ turns: page.reverse(), nextCursor });
    });
  }

  getSessionState(conversationId: string): SessionState {
    const record = this.recordFor(conversationId);
    if (record) return record.cell.sessionState;
    return {
      lifecycle: 'closed',
      activeTurnId: null,
      pendingPermissions: [],
      lastStopReason: null,
      lastTurnErrored: false,
      queuedPrompts: [],
      agentTurnActive: false,
      backgroundAgentCount: 0,
      isGenerating: false,
      canSubmit: false,
      canCancel: false,
    };
  }

  getTerminals(conversationId: string): TerminalState[] {
    return this.terminals.listByConversation(conversationId);
  }

  getHostTerminals(): TerminalState[] {
    return this.terminals.listAll();
  }

  getLiveModels(conversationId: string): SessionLiveModels | null {
    return this.sessionHost.models.peekMember(conversationId) ?? null;
  }

  syncTerminals(conversationId: string): void {
    const record = this.recordFor(conversationId);
    if (!record) return;
    this.syncRecord(record);
  }

  killAllTerminals(): void {
    this.terminals.killAll();
  }

  onSessionUpdate(
    connection: AcpConnectionContext,
    params: SessionNotification,
    event: NormalizedEvent
  ): void {
    const conversationId = this.resolveConversationForSession(
      connectionOwnerId(connection),
      params.sessionId
    );
    if (!conversationId) {
      this.deps.logger.warn('SessionManager: sessionUpdate for unknown sessionId', {
        sessionId: params.sessionId,
      });
      return;
    }

    const record = this.recordFor(conversationId);
    if (!record) return;
    this.lifecycle.recordOutput(conversationId);
    if (record.cell.acpSessionId !== params.sessionId) {
      record.cell.setAcpSessionId(params.sessionId);
      this.registerRoute(connectionOwnerId(connection), params.sessionId, conversationId);
      this.lifecycle.providerSessionId(conversationId, {
        conversationId,
        providerSessionId: params.sessionId,
      });
    }
    record.cell.recordRaw({
      kind: 'session_update',
      sessionId: params.sessionId,
      update: params.update,
    });
    this.applyRawMeta(record.cell, params.update);
    record.cell.push(event);
    this.syncRecord(record);
  }

  onPermissionRequest(
    connection: AcpConnectionContext,
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const conversationId = this.resolveConversationForSession(
      connectionOwnerId(connection),
      params.sessionId
    );
    const record = conversationId ? this.recordFor(conversationId) : undefined;
    if (!conversationId || !record) return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    this.lifecycle.recordOutput(conversationId);
    const response = record.cell.requestPermission(params);
    this.syncRecord(record);
    return response;
  }

  onCreateTerminal(
    connection: AcpConnectionContext,
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
    const conversationId = this.resolveConversationForSession(
      connectionOwnerId(connection),
      params.sessionId
    );
    if (!conversationId) {
      throw new Error(`SessionManager: no conversation for ACP sessionId ${params.sessionId}`);
    }
    return this.ports.terminals.createTerminal(conversationId, connection.cwd, params);
  }

  onProcessClosed(processKey: string, processGeneration: number, exitCode: number | null): void {
    const records = new Set([...this.activations.values(), ...this.materializing.values()]);
    for (const record of records) {
      if (
        record.processKey !== processKey ||
        record.processGeneration !== processGeneration ||
        record.disposed
      ) {
        continue;
      }
      // The pooled process is gone: invalidation owns the pool entry, so the evict
      // step must not release the dead lease.
      record.releaseLeaseOnEvict = false;
      record.cell.processClosed(exitCode);
      // The active intent is kept so restart reconciliation can restore the
      // conversation; the cell's onClosed eviction (triggered above) coalesces.
      void this.evict(record.input.conversationId, {
        cause: 'process-exited',
        intent: 'keep',
      });
      void this.connections.invalidate({
        providerId: record.input.providerId,
        cwd: record.input.cwd,
      });
    }
  }

  private createRecord(
    input: AcpStartInput,
    connection: AcpConnectionEntry,
    connectionLease: Lease<PooledAcpProcess>,
    acpSessionId: string,
    activationId: string,
    projection: SessionLiveModels,
    scope: Scope
  ): SessionRecord {
    const recordRef: { current?: SessionRecord } = {};
    const callbacks: SessionCellCallbacks = {
      onSessionStateChanged: () => {
        if (recordRef.current) this.syncRecord(recordRef.current);
      },
      onTranscriptChanged: () => {
        if (recordRef.current) this.syncRecord(recordRef.current);
      },
      // Machine-driven close (usually process death): full teardown; the active
      // intent is kept so restart reconciliation can restore the conversation.
      onClosed: () => {
        if (!recordRef.current || !this.isCurrentRecord(recordRef.current)) return;
        void this.evict(input.conversationId, {
          cause: 'process-exited',
          intent: 'keep',
        });
      },
      onSendQueuedPrompt: () => {
        if (recordRef.current) this.syncRecord(recordRef.current);
      },
    };
    const cell = new SessionCell({
      conversationId: input.conversationId,
      providerId: input.providerId,
      acpSessionId,
      agent: connection.agent,
      resolveAttachment: this.deps.resolveAttachment,
      logger: this.deps.logger,
      callbacks,
    });
    const machineStateBinding = { dispose: () => {} };
    const record: SessionRecord = {
      activationId,
      resumeOutcome: null,
      input,
      processKey: connection.key,
      processGeneration: connection.generation,
      connectionLease,
      releaseLeaseOnEvict: true,
      cell,
      projection,
      mcpServers: [],
      machineStateBinding,
      disposed: false,
    };
    recordRef.current = record;
    this.materializing.set(input.conversationId, record);
    this.syncRecord(record);
    machineStateBinding.dispose = cell.machine.subscribe(() => this.syncRecord(record));
    scope.add(() => this.teardownRecord(record));
    return record;
  }

  private queueInitialPrompts(record: SessionRecord): Result<void, InvalidStateError> {
    for (const prompt of record.input.initialQueue ?? []) {
      const result = record.cell.queuePrompt(prompt);
      if (!result.success) return result;
    }
    return ok();
  }

  private syncRecord(record: SessionRecord): void {
    if (!this.isCurrentRecord(record)) return;
    record.projection.source.set(this.buildSnapshot(record));
    this.upsertSessionSummary(record.input, record.cell, record.cell.sessionState);
  }

  private buildSnapshot(record: SessionRecord): ActivationSnapshot {
    return {
      activationId: record.activationId,
      state: record.cell.sessionState,
      config: record.cell.config,
      usage: record.cell.usage,
      plan: record.cell.transcript.plan,
      agents: record.cell.transcript.agents,
      activeTurn: record.cell.transcript.activeTurn,
      terminals: this.getTerminals(record.input.conversationId),
      mcpServers: record.mcpServers,
    };
  }

  private async resolveSessionMcpServers(providerId: string, connection: AcpConnectionEntry) {
    try {
      const result = await this.deps.agentHost.readMcpServers(providerId);
      if (!result.success) {
        this.deps.logger.warn('SessionManager: failed to read MCP servers for session', {
          providerId,
          error: 'message' in result.error ? result.error.message : result.error.type,
        });
        return [];
      }

      return registrationsToAcpMcpServers(result.data, connection.mcpCapabilities);
    } catch (error) {
      this.deps.logger.warn('SessionManager: failed to read MCP servers for session', {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private upsertSessionSummary(
    input: AcpStartInput,
    cell: SessionCell | null,
    state: {
      lifecycle: SessionState['lifecycle'];
      isGenerating: boolean;
      backgroundAgentCount: number;
      pendingPermissions?: SessionState['pendingPermissions'];
      queuedPrompts?: SessionState['queuedPrompts'];
      pendingPermissionCount?: number;
      queuedPromptCount?: number;
    }
  ): void {
    const summary: Omit<SessionSummary, 'updatedAt'> = {
      conversationId: input.conversationId,
      providerId: input.providerId,
      cwd: input.cwd,
      lifecycle: state.lifecycle,
      isGenerating: state.isGenerating,
      lastStopReason: cell?.sessionState.lastStopReason ?? null,
      lastTurnErrored: cell?.sessionState.lastTurnErrored ?? false,
      pendingPermissionCount: state.pendingPermissionCount ?? state.pendingPermissions?.length ?? 0,
      backgroundAgentCount: state.backgroundAgentCount,
      queuedPromptCount: state.queuedPromptCount ?? state.queuedPrompts?.length ?? 0,
      title: cell?.transcript.title ?? null,
    };
    const activity = this.lifecycle.activity(input.conversationId);
    if (activity.lastInputAt !== null) {
      summary.lastInputAt = activity.lastInputAt;
    }
    if (activity.lastOutputAt !== null) {
      summary.lastOutputAt = activity.lastOutputAt;
    }
    this.sessionsList.states.list.update((previous) => {
      const current = previous[input.conversationId];
      if (current && sessionSummaryEquals(current, summary)) return previous;
      return produce(previous, (draft) => {
        draft[input.conversationId] = { ...summary, updatedAt: this.clock.now() };
      });
    });
  }

  async dispose(): Promise<void> {
    this.lifecycle.dispose();
    await this.activations.dispose();
    await Promise.all([this.sessionHost.dispose(), this.sessionsHost.dispose()]);
  }

  reconcile(): Promise<void> {
    return this.lifecycle.reconcile();
  }

  /** Deterministic lifecycle sweep seam used by runtime tests. */
  sweepNow(): Promise<void> {
    return this.lifecycle.sweepNow();
  }

  private deleteSessionSummary(conversationId: string): void {
    this.sessionsList.states.list.update((previous) => {
      if (!(conversationId in previous)) return previous;
      return produce(previous, (draft) => {
        delete draft[conversationId];
      });
    });
  }

  private evict(conversationId: string, options: EvictOptions): Promise<void> {
    const existing = this.evictions.get(conversationId);
    if (existing) return existing;
    const pending = this.lifecycle.evict(conversationId, options).finally(() => {
      if (this.evictions.get(conversationId) === pending) this.evictions.delete(conversationId);
    });
    this.evictions.set(conversationId, pending);
    return pending;
  }

  private syncSessionActivity(conversationId: string, activity: ActivityFields): void {
    this.sessionsList.states.list.update((previous) => {
      const current = previous[conversationId];
      if (!current) return previous;
      const lastInputAt = activity.lastInputAt ?? current.lastInputAt;
      const lastOutputAt = activity.lastOutputAt ?? current.lastOutputAt;
      if (current.lastInputAt === lastInputAt && current.lastOutputAt === lastOutputAt) {
        return previous;
      }
      return produce(previous, (draft) => {
        const next = draft[conversationId];
        if (!next) return;
        if (activity.lastInputAt !== null) next.lastInputAt = activity.lastInputAt;
        if (activity.lastOutputAt !== null) next.lastOutputAt = activity.lastOutputAt;
        next.updatedAt = this.clock.now();
      });
    });
  }

  private lifecycleSnapshot(conversationId: string): SessionSnapshotJudgment | null {
    const record = this.activations.get(conversationId);
    if (!record) return null;
    const state = record.cell.sessionState;
    return {
      running: true,
      busy:
        state.isGenerating ||
        state.pendingPermissions.length > 0 ||
        state.queuedPrompts.length > 0 ||
        state.backgroundAgentCount > 0,
    };
  }

  /**
   * loadSession-fallback teardown: the same connection lease is reused by the
   * newSession retry, so this must NOT release it, and the session did not end
   * (no report, no intent write). Deliberately bypasses the chassis evict.
   */
  private discardReplacedRecord(record: SessionRecord): void {
    void this.teardownRecord(record, { releaseLease: false });
  }

  private recordFor(conversationId: string): SessionRecord | undefined {
    return this.activations.get(conversationId) ?? this.materializing.get(conversationId);
  }

  private activationInput(
    conversationId: string,
    activation?: AcpStartInput
  ): Result<AcpStartInput, AcpActivationError> {
    if (activation) {
      return activation.conversationId === conversationId
        ? ok(activation)
        : acpErr.invalidState('Activation descriptor does not match the conversation');
    }
    const current = this.recordFor(conversationId);
    return current ? ok(current.input) : acpErr.activationMissing(conversationId);
  }

  private resolveActivationTarget(
    conversationId: string,
    activation: AcpStartInput | undefined,
    expectedActivationId: string | undefined
  ): Result<AcpStartInput, AcpActivationError | StaleActivationError> {
    if (!expectedActivationId) return this.activationInput(conversationId, activation);
    const current = this.recordFor(conversationId);
    if (!current) return acpErr.activationMissing(conversationId);
    if (current.activationId !== expectedActivationId) {
      return acpErr.staleActivation(expectedActivationId);
    }
    return ok(current.input);
  }

  private checkActivationFence(
    record: SessionRecord,
    expectedActivationId?: string
  ): Result<void, StaleActivationError> {
    if (expectedActivationId && record.activationId !== expectedActivationId) {
      return acpErr.staleActivation(expectedActivationId);
    }
    return ok();
  }

  private async useSerialized<T, E>(
    conversationId: string,
    activation: AcpStartInput | undefined,
    expectedActivationId: string | undefined,
    operation: (record: SessionRecord) => Result<T, E> | Promise<Result<T, E>>
  ): Promise<Result<T, AcpActivationError | StaleActivationError | E>> {
    const target = this.resolveActivationTarget(conversationId, activation, expectedActivationId);
    if (!target.success) return target;
    return this.activations.use<T, StaleActivationError | E>(target.data, async (record) => {
      const fence = this.checkActivationFence(record, expectedActivationId);
      if (!fence.success) return fence;
      this.lifecycle.recordInput(conversationId);
      return operation(record);
    });
  }

  private isCurrentRecord(record: SessionRecord): boolean {
    return !record.disposed && this.recordFor(record.input.conversationId) === record;
  }

  private async teardownRecord(
    record: SessionRecord,
    options: { releaseLease?: boolean } = {}
  ): Promise<void> {
    if (record.disposed) return;
    record.disposed = true;
    record.cell.dispose();
    record.machineStateBinding.dispose();
    this.unregisterRoutes(connectionOwnerId(record), record.input.conversationId);
    if (this.materializing.get(record.input.conversationId) === record) {
      this.materializing.delete(record.input.conversationId);
    }
    this.terminals.disposeConversation(record.input.conversationId);
    if (options.releaseLease !== false && record.releaseLeaseOnEvict) {
      await record.connectionLease.release();
    }
  }

  private onActivationStateChanged(
    change: LifecycleRegistryStateChange<SessionRecord, AcpStartError, never>
  ): void {
    switch (change.current.kind) {
      case 'ready':
        if (this.materializing.get(change.key) === change.current.value) {
          this.materializing.delete(change.key);
        }
        this.lifecycle.started(change.key, {
          conversationId: change.key,
          providerSessionId: change.current.value.cell.acpSessionId,
          resumeOutcome: change.current.value.resumeOutcome,
        });
        return;
      case 'idle':
      case 'start-failed':
      case 'disposed': {
        const projection = this.sessionHost.models.peekMember(change.key);
        if (projection) projection.source.set(null);
        return;
      }
      case 'starting':
      case 'stopping':
      case 'stop-failed':
        return;
    }
  }

  private resolveConversationForSession(processKey: string, acpSessionId: string): string | null {
    const route = this.routes.get(processKey)?.get(acpSessionId);
    if (route) return route;
    const loading = this.loadingConversations.get(processKey);
    const pending = loading?.values().next().value;
    if (!pending) return null;
    this.registerRoute(processKey, acpSessionId, pending);
    return pending;
  }

  private registerRoute(processKey: string, acpSessionId: string, conversationId: string): void {
    let bySession = this.routes.get(processKey);
    if (!bySession) {
      bySession = new Map();
      this.routes.set(processKey, bySession);
    }
    bySession.set(acpSessionId, conversationId);
  }

  private unregisterRoutes(processKey: string, conversationId: string): void {
    const bySession = this.routes.get(processKey);
    if (!bySession) return;
    for (const [sessionId, mappedConversationId] of bySession) {
      if (mappedConversationId === conversationId) bySession.delete(sessionId);
    }
    if (bySession.size === 0) this.routes.delete(processKey);
  }

  private addLoading(processKey: string, conversationId: string): void {
    let loading = this.loadingConversations.get(processKey);
    if (!loading) {
      loading = new Set();
      this.loadingConversations.set(processKey, loading);
    }
    loading.add(conversationId);
  }

  private removeLoading(processKey: string, conversationId: string): void {
    const loading = this.loadingConversations.get(processKey);
    if (!loading) return;
    loading.delete(conversationId);
    if (loading.size === 0) this.loadingConversations.delete(processKey);
  }

  private applyRawMeta(cell: SessionCell, update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case 'current_mode_update':
        cell.applySessionMeta({
          modes: {
            currentModeId: update.currentModeId,
            availableModes: cell.config.modeOptions?.available ?? [],
          },
        });
        break;
      case 'config_option_update':
        cell.applySessionMeta({ configOptions: update.configOptions });
        break;
      default:
        break;
    }
  }

  private async applyInitialMode(record: SessionRecord, input: AcpStartInput): Promise<void> {
    const modeId = input.modeId;
    if (!modeId) return;
    const modeOptions = record.cell.config.modeOptions;
    if (!modeOptions?.available.some((mode) => mode.id === modeId)) {
      this.deps.logger.debug('SessionManager: persisted mode not advertised, skipping', {
        conversationId: input.conversationId,
        providerId: input.providerId,
        modeId,
      });
      return;
    }
    if (modeOptions.selected === modeId) return;
    const result = await record.cell.setMode(modeId);
    if (!result.success) {
      this.deps.logger.warn('SessionManager: failed to apply initial mode', {
        conversationId: input.conversationId,
        providerId: input.providerId,
        modeId,
        error: result.error,
      });
    }
  }

  private buildNewSessionRequest(
    cwd: string,
    mcpServers: NewSessionRequest['mcpServers']
  ): NewSessionRequest {
    return { cwd, mcpServers };
  }

  private buildLoadSessionRequest(
    cwd: string,
    sessionId: string,
    mcpServers: LoadSessionRequest['mcpServers']
  ): LoadSessionRequest {
    return { cwd, sessionId, mcpServers };
  }
}

function sessionSummaryEquals(
  current: SessionSummary,
  candidate: Omit<SessionSummary, 'updatedAt'>
): boolean {
  return (
    current.conversationId === candidate.conversationId &&
    current.providerId === candidate.providerId &&
    current.cwd === candidate.cwd &&
    current.lifecycle === candidate.lifecycle &&
    current.isGenerating === candidate.isGenerating &&
    current.lastStopReason === candidate.lastStopReason &&
    current.lastTurnErrored === candidate.lastTurnErrored &&
    current.pendingPermissionCount === candidate.pendingPermissionCount &&
    current.backgroundAgentCount === candidate.backgroundAgentCount &&
    current.queuedPromptCount === candidate.queuedPromptCount &&
    current.title === candidate.title &&
    current.lastInputAt === candidate.lastInputAt &&
    current.lastOutputAt === candidate.lastOutputAt
  );
}

function isAuthRequiredError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { code?: unknown; cause?: unknown };
  if (value.code === -32000) return true;
  return isAuthRequiredError(value.cause);
}

function connectionOwnerId(connection: AcpConnectionContext | SessionRecord): string {
  return 'key' in connection
    ? `${connection.key}:${connection.generation}`
    : `${connection.processKey}:${connection.processGeneration}`;
}
