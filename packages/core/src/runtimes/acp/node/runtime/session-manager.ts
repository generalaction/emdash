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
import { acquireResourceAsResult } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import type {
  AcpCancelTurnError,
  AcpChangeQueuePromptOrderError,
  AcpDeleteQueuedPromptError,
  AcpEditQueuedPromptError,
  AcpExportRawLogError,
  AcpExportTranscriptError,
  AcpResolvePermissionError,
  AcpSendPromptError,
  AcpSetModeOptionError,
  AcpSetModelOptionError,
  AcpSetPromptDraftError,
  AcpStartError,
  AcpKillError,
  AgentState,
  InvalidStateError,
  NormalizedEvent,
  PlanState,
  PromptDraft,
  PromptDraftUpdate,
  SessionConfigState,
  SessionMcpServer,
  SessionState,
  SessionSummary,
  SessionUsage,
  TerminalState,
  TranscriptTurn,
} from '#runtimes/acp/api';
import { acpErr, acpStartInputSchema } from '#runtimes/acp/api';
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
import { projectSessionState } from '#runtimes/acp/node/machine/machine';
import { SessionCell, type AcpChatHistory } from '#runtimes/acp/node/session/cell';
import type { SessionCellCallbacks } from '#runtimes/acp/node/session/cell-deps';
import {
  createAcpSessionLiveHost,
  createAcpSessionsLiveHost,
  createSessionLiveModels,
  createSessionsListModel,
  publishLiveModelState,
  produceCell,
  type AcpSessionLiveHost,
  type AcpSessionsLiveHost,
  type SessionLiveModels,
  type SessionsListModel,
} from '#runtimes/acp/node/state/live-models';
import type {
  ActivityFields,
  ConversationSessionLifecycle,
  SessionSnapshotJudgment,
} from '#services/session-lifecycle/api';
import { createSessionLifecycle } from '#services/session-lifecycle/node';
import { registrationsToAcpMcpServers, summarizeAcpMcpServers } from './mcp-servers';
import type { AcpRuntimeDeps, AcpStartInput, SendPromptInput } from './types';

interface SessionRecord {
  input: AcpStartInput;
  processKey: string;
  connectionLease: Lease<PooledAcpProcess>;
  /**
   * Cleared before evicting a record whose pooled process already died: the pool
   * entry is invalidated instead, so the evict step must not release the lease.
   */
  releaseLeaseOnEvict: boolean;
  cell: SessionCell;
  live: SessionLiveModels;
  machineStateBinding: { dispose(): void };
  lastSynced: {
    config?: SessionConfigState;
    usage?: SessionUsage | null;
    plan?: PlanState | null;
    agents?: AgentState[];
    activeTurn?: TranscriptTurn | null;
    draft?: PromptDraft | null;
    terminals?: TerminalState[];
    mcpServers?: SessionMcpServer[];
  };
}

export interface HistoryPage {
  turns: TranscriptTurn[];
  nextCursor: number | null;
}

export class SessionManager implements InboundRouter {
  readonly sessionHost: AcpSessionLiveHost = createAcpSessionLiveHost();
  readonly sessionsHost: AcpSessionsLiveHost = createAcpSessionsLiveHost();
  readonly sessionsList: SessionsListModel = createSessionsListModel(this.sessionsHost);
  private readonly cells = new Map<string, SessionRecord>();
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
    this.lifecycle = createSessionLifecycle<AcpStartInput, void>({
      name: 'SessionManager',
      logger: deps.logger,
      clock: this.clock,
      idlePolicy: deps.lifecycle?.session,
      sweepIntervalMs: deps.lifecycle?.sweepIntervalMs,
      entries: () => this.cells.keys(),
      snapshot: (conversationId) => this.lifecycleSnapshot(conversationId),
      syncListEntry: (conversationId, activity) =>
        this.syncSessionActivity(conversationId, activity),
      deactivate: async (conversationId, cause) => {
        await this.stop(conversationId, cause);
      },
      evictSteps: [
        { name: 'cell', run: (key) => this.cells.get(key)?.cell.dispose() },
        {
          name: 'machine-state-binding',
          run: (key) => this.cells.get(key)?.machineStateBinding.dispose(),
        },
        {
          name: 'routes',
          run: (key) => {
            const record = this.cells.get(key);
            if (record) this.unregisterRoutes(record.processKey, key);
          },
        },
        { name: 'live-models', run: (key) => this.cells.get(key)?.live.dispose() },
        {
          name: 'connection-lease',
          run: (key) => {
            const record = this.cells.get(key);
            if (record?.releaseLeaseOnEvict) void record.connectionLease.release();
          },
        },
        {
          name: 'record',
          run: (key) => {
            this.cells.delete(key);
          },
        },
        {
          name: 'conversation-terminals',
          run: (key) => {
            this.terminals.disposeConversation(key);
          },
        },
        { name: 'sessions-list-summary', run: (key) => this.deleteSessionSummary(key) },
      ],
      conversation: {
        intents: deps.intents,
        reports: deps.conversationReports,
        activePayload: (conversationId) => {
          const record = this.cells.get(conversationId);
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

  async start(input: AcpStartInput): Promise<Result<{ sessionId: string }, AcpStartError>> {
    const existing = this.cells.get(input.conversationId);
    if (existing) {
      this.lifecycle.saveIntent(input.conversationId);
      return ok({ sessionId: existing.cell.acpSessionId });
    }
    this.lifecycle.recordInput(input.conversationId);

    this.upsertSessionSummary(input, null, {
      lifecycle: 'starting',
      isGenerating: false,
      pendingPermissionCount: 0,
      backgroundAgentCount: 0,
      queuedPromptCount: 0,
    });

    const binding = this.deps.agentHost.resolveAcp(input.providerId);
    if (!binding) {
      // Start-failure teardown: no record exists yet, but the eviction drops the
      // activity tracker and summary entry (the old failed-start leak).
      await this.lifecycle.evict(input.conversationId, { intent: 'keep' });
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
      await this.lifecycle.evict(input.conversationId, { intent: 'keep' });
      return acquire;
    }

    const acquired = acquire.data;
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
        record = this.createRecord(input, connection, acquired, input.sessionId);
        this.addLoading(connection.key, input.conversationId);
        this.registerRoute(connection.key, input.sessionId, input.conversationId);
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
          this.removeLoading(connection.key, input.conversationId);
        }

        if (!loaded) {
          this.discardReplacedRecord(input.conversationId);
          record = null;
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
          // No record exists here (the loadSession fallback already discarded its
          // record), so the lease is still caller-held and released explicitly.
          await this.lifecycle.evict(input.conversationId, { intent: 'keep' });
          await acquired.release();
          return acpErr.newSessionFailed(toSerializedError(e));
        }
        record = this.createRecord(input, connection, acquired, response.sessionId);
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

      this.registerRoute(connection.key, record.cell.acpSessionId, input.conversationId);

      this.publishSessionMcpServers(record, mcpServerSummary);
      this.syncRecord(record);
      // `started` reports sessionStarted and persists the active intent.
      this.lifecycle.started(input.conversationId, {
        conversationId: input.conversationId,
        providerSessionId: record.cell.acpSessionId,
        resumeOutcome,
      });
      return ok({ sessionId: record.cell.acpSessionId });
    } catch (e) {
      // When a record exists it holds the lease, so the evict step releases it;
      // otherwise the caller-held lease is released explicitly.
      const recordHeldLease = this.cells.has(input.conversationId);
      await this.lifecycle.evict(input.conversationId, { intent: 'keep' });
      if (!recordHeldLease) await acquired.release();
      if (isAuthRequiredError(e)) {
        return acpErr.authRequired(toSerializedError(e));
      }
      return acpErr.initializeFailed(toSerializedError(e));
    }
  }

  async prompt(input: SendPromptInput): Promise<Result<{ queued: boolean }, AcpSendPromptError>> {
    const record = this.cells.get(input.conversationId);
    if (!record) return acpErr.conversationNotFound(input.conversationId);
    this.lifecycle.recordInput(input.conversationId);
    if (input.placement === 'queue') {
      const state = record.cell.sessionState;
      if (state.lifecycle !== 'ready' || state.isGenerating || state.queuedPrompts.length > 0) {
        const result = record.cell.queuePrompt(input.prompt);
        if (!result.success) return result;
        return ok({ queued: true });
      }
    }
    return record.cell.prompt(input.prompt);
  }

  editQueuedPrompt(
    conversationId: string,
    id: string,
    input: SendPromptInput['prompt']
  ): Result<void, AcpEditQueuedPromptError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.editQueuedPrompt(id, input);
  }

  removeQueuedPrompt(conversationId: string, id: string): Result<void, AcpDeleteQueuedPromptError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.removeQueuedPrompt(id);
  }

  reorderQueue(
    conversationId: string,
    ids: readonly string[]
  ): Result<void, AcpChangeQueuePromptOrderError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.reorderQueue(ids);
  }

  async cancel(conversationId: string): Promise<Result<void, AcpCancelTurnError>> {
    const record = this.cells.get(conversationId);
    if (!record) return ok();
    return record.cell.cancel();
  }

  setPromptDraft(
    conversationId: string,
    draft: PromptDraftUpdate
  ): Result<void, AcpSetPromptDraftError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.setPromptDraft(draft);
  }

  async stop(conversationId: string, cause = 'user'): Promise<Result<void, AcpKillError>> {
    this.cells
      .get(conversationId)
      ?.cell.closeSession()
      .catch(() => {});
    await this.lifecycle.evict(conversationId, { cause, intent: 'suspend' });
    return ok();
  }

  async kill(conversationId: string): Promise<Result<void, AcpKillError>> {
    this.cells
      .get(conversationId)
      ?.cell.closeSession()
      .catch(() => {});
    await this.lifecycle.evict(conversationId, { cause: 'user', intent: 'remove' });
    return ok();
  }

  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string
  ): Result<void, AcpResolvePermissionError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    this.lifecycle.recordInput(conversationId);
    return record.cell.resolvePermission(requestId, optionId);
  }

  async setMode(
    conversationId: string,
    modeId: string
  ): Promise<Result<void, AcpSetModeOptionError>> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.setMode(modeId);
  }

  async setConfigOption(
    conversationId: string,
    dimension: 'model' | 'effort',
    value: string
  ): Promise<Result<void, AcpSetModelOptionError>> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.setConfigOption(dimension, value);
  }

  isRunning(conversationId: string): boolean {
    return this.cells.has(conversationId);
  }

  getChatHistory(conversationId: string): AcpChatHistory {
    return this.cells.get(conversationId)?.cell.history() ?? { committed: [], active: null };
  }

  exportParsedTranscript(conversationId: string): Result<string, AcpExportTranscriptError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return ok(record.cell.exportParsedTranscript());
  }

  exportRawAcpLog(conversationId: string): Result<string, AcpExportRawLogError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return ok(record.cell.exportRawLog());
  }

  getHistory(conversationId: string, before?: number, limit = 50): HistoryPage {
    const turns = this.getChatHistory(conversationId).committed;
    const filtered = before === undefined ? turns : turns.filter((turn) => turn.seq < before);
    const page = [...filtered].sort((a, b) => b.seq - a.seq).slice(0, limit);
    const nextCursor = page.length === limit ? page.at(-1)!.seq : null;
    return { turns: page.reverse(), nextCursor };
  }

  getSessionState(conversationId: string): SessionState {
    const record = this.cells.get(conversationId);
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
    return this.cells.get(conversationId)?.live ?? null;
  }

  syncTerminals(conversationId: string): void {
    const record = this.cells.get(conversationId);
    if (!record) return;
    const terminals = this.getTerminals(conversationId);
    publishLiveModelState(record.live.states.terminals, terminals, record.lastSynced.terminals);
    record.lastSynced.terminals = terminals;
  }

  killAllTerminals(): void {
    this.terminals.killAll();
  }

  onSessionUpdate(
    connection: AcpConnectionContext,
    params: SessionNotification,
    event: NormalizedEvent
  ): void {
    const conversationId = this.resolveConversationForSession(connection.key, params.sessionId);
    if (!conversationId) {
      this.deps.logger.warn('SessionManager: sessionUpdate for unknown sessionId', {
        sessionId: params.sessionId,
      });
      return;
    }

    const record = this.cells.get(conversationId);
    if (!record) return;
    this.lifecycle.recordOutput(conversationId);
    if (record.cell.acpSessionId !== params.sessionId) {
      record.cell.setAcpSessionId(params.sessionId);
      this.registerRoute(connection.key, params.sessionId, conversationId);
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
    const conversationId = this.resolveConversationForSession(connection.key, params.sessionId);
    const record = conversationId ? this.cells.get(conversationId) : undefined;
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
    const conversationId = this.resolveConversationForSession(connection.key, params.sessionId);
    if (!conversationId) {
      throw new Error(`SessionManager: no conversation for ACP sessionId ${params.sessionId}`);
    }
    return this.ports.terminals.createTerminal(conversationId, connection.cwd, params);
  }

  onProcessClosed(processKey: string, exitCode: number | null): void {
    for (const record of [...this.cells.values()]) {
      if (record.processKey !== processKey) continue;
      // The pooled process is gone: invalidation owns the pool entry, so the evict
      // step must not release the dead lease.
      record.releaseLeaseOnEvict = false;
      record.cell.processClosed(exitCode);
      // The active intent is kept so restart reconciliation can restore the
      // conversation; the cell's onClosed eviction (triggered above) coalesces.
      void this.lifecycle.evict(record.input.conversationId, {
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
    acpSessionId: string
  ): SessionRecord {
    const record = {} as SessionRecord;
    const callbacks: SessionCellCallbacks = {
      onSessionStateChanged: () => this.syncRecord(record),
      onTranscriptChanged: () => this.syncRecord(record),
      onDraftChanged: () => this.syncRecord(record),
      // Machine-driven close (usually process death): full teardown; the active
      // intent is kept so restart reconciliation can restore the conversation.
      onClosed: () =>
        void this.lifecycle.evict(input.conversationId, {
          cause: 'process-exited',
          intent: 'keep',
        }),
      onSendQueuedPrompt: () => this.syncRecord(record),
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
    const live = createSessionLiveModels(this.sessionHost, input.conversationId, cell.sessionState);
    const syncMachineState = () =>
      live.states.state.set(projectSessionState(cell.machine.current()));
    syncMachineState();
    const unsubscribeMachine = cell.machine.subscribe(syncMachineState);
    const machineStateBinding = { dispose: unsubscribeMachine };
    Object.assign(record, {
      input,
      processKey: connection.key,
      connectionLease,
      releaseLeaseOnEvict: true,
      cell,
      live,
      machineStateBinding,
      lastSynced: {
        config: cell.config,
        usage: cell.usage,
        plan: null,
        agents: [],
        activeTurn: null,
        draft: null,
        terminals: [],
        mcpServers: [],
      },
    });
    this.cells.set(input.conversationId, record);
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
    const state = record.cell.sessionState;

    const config = record.cell.config;
    publishLiveModelState(record.live.states.config, config, record.lastSynced.config);
    record.lastSynced.config = config;

    const usage = record.cell.usage;
    publishLiveModelState(record.live.states.usage, usage, record.lastSynced.usage);
    record.lastSynced.usage = usage;

    const plan = record.cell.transcript.plan ?? null;
    publishLiveModelState(record.live.states.plan, plan, record.lastSynced.plan);
    record.lastSynced.plan = plan;

    const agents = record.cell.transcript.agents;
    const agentSnapshot = [...agents];
    publishLiveModelState(record.live.states.agents, agentSnapshot, record.lastSynced.agents);
    record.lastSynced.agents = agentSnapshot;

    const activeTurn = record.cell.transcript.activeTurn;
    publishLiveModelState(record.live.states.activeTurn, activeTurn, record.lastSynced.activeTurn);
    record.lastSynced.activeTurn = activeTurn;

    const draft = record.cell.promptDraft;
    publishLiveModelState(record.live.states.draft, draft, record.lastSynced.draft);
    record.lastSynced.draft = draft;

    this.syncTerminals(record.input.conversationId);

    this.upsertSessionSummary(record.input, record.cell, state);
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

  private publishSessionMcpServers(record: SessionRecord, mcpServers: SessionMcpServer[]): void {
    publishLiveModelState(record.live.states.mcpServers, mcpServers, record.lastSynced.mcpServers);
    record.lastSynced.mcpServers = mcpServers;
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
    const summary: SessionSummary = {
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
      updatedAt: this.clock.now(),
    };
    const activity = this.lifecycle.activity(input.conversationId);
    if (activity.lastInputAt !== null) {
      summary.lastInputAt = activity.lastInputAt;
    }
    if (activity.lastOutputAt !== null) {
      summary.lastOutputAt = activity.lastOutputAt;
    }
    produceCell(this.sessionsList.states.list, (draft) => {
      draft[input.conversationId] = summary;
    });
  }

  dispose(): void {
    this.lifecycle.dispose();
  }

  reconcile(): Promise<void> {
    return this.lifecycle.reconcile();
  }

  private deleteSessionSummary(conversationId: string): void {
    produceCell(this.sessionsList.states.list, (draft) => {
      delete draft[conversationId];
    });
  }

  private syncSessionActivity(conversationId: string, activity: ActivityFields): void {
    produceCell(this.sessionsList.states.list, (draft) => {
      const current = draft[conversationId];
      if (!current) return;
      if (activity.lastInputAt !== null) current.lastInputAt = activity.lastInputAt;
      if (activity.lastOutputAt !== null) current.lastOutputAt = activity.lastOutputAt;
    });
  }

  private lifecycleSnapshot(conversationId: string): SessionSnapshotJudgment | null {
    const record = this.cells.get(conversationId);
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
  private discardReplacedRecord(conversationId: string): void {
    const record = this.cells.get(conversationId);
    if (!record) return;
    record.cell.dispose();
    record.machineStateBinding.dispose();
    this.unregisterRoutes(record.processKey, conversationId);
    this.cells.delete(conversationId);
    this.terminals.disposeConversation(conversationId);
    record.live.dispose();
    this.deleteSessionSummary(conversationId);
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

function isAuthRequiredError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { code?: unknown; cause?: unknown };
  if (value.code === -32000) return true;
  return isAuthRequiredError(value.cause);
}
