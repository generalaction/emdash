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
import { bindMachineToLiveState, type MachineLiveStateBinding } from '@emdash/wire';
import {
  compileIdlePolicy,
  createIdleSweeper,
  createIoActivityTracker,
  type IdlePolicy,
  type IdleSweeper,
  type IoActivitySnapshot,
  type IoActivityTracker,
} from '@primitives/io-activity/api';
import type {
  AcpCancelTurnError,
  AcpChangeQueuePromptOrderError,
  AcpDeleteQueuedPromptError,
  AcpEditQueuedPromptError,
  AcpExportRawLogError,
  AcpExportTranscriptError,
  AcpQueuePromptError,
  AcpResolvePermissionError,
  AcpSendPromptError,
  AcpSetModeOptionError,
  AcpSetModelOptionError,
  AcpSetPromptDraftError,
  AcpStartSessionError,
  AcpStopSessionError,
  AgentState,
  InvalidStateError,
  NormalizedEvent,
  PlanState,
  PromptDraft,
  PromptDraftUpdate,
  SessionConfigState,
  SessionState,
  SessionSummary,
  SessionUsage,
  TerminalState,
  TranscriptTurn,
} from '@runtimes/acp/api';
import { acpErr, acpStartInputSchema } from '@runtimes/acp/api';
import type { InboundRouter } from '@runtimes/acp/node/agent-ports/agent-client';
import type { FsPort } from '@runtimes/acp/node/agent-ports/fs-port';
import type { AgentTerminalManager } from '@runtimes/acp/node/agent-ports/terminal-manager';
import type { TerminalPort } from '@runtimes/acp/node/agent-ports/terminal-port';
import {
  isAcpConnectionError,
  type AcpConnectionEntry,
  type AcpConnectionContext,
  type AcpConnectionKey,
  type AcpConnectionSource,
  type PooledAcpProcess,
} from '@runtimes/acp/node/connection/source';
import { projectSessionState } from '@runtimes/acp/node/machine/machine';
import { SessionCell, type AcpChatHistory } from '@runtimes/acp/node/session/cell';
import type { SessionCellCallbacks } from '@runtimes/acp/node/session/cell-deps';
import {
  createAcpSessionLiveHost,
  createAcpSessionsLiveHost,
  createSessionLiveModels,
  createSessionsListModel,
  publishLiveModelState,
  type AcpSessionLiveHost,
  type AcpSessionsLiveHost,
  type SessionLiveModels,
  type SessionsListModel,
} from '@runtimes/acp/node/state/live-models';
import type { AcpRuntimeDeps, AcpStartInput, SendPromptInput } from './types';

interface SessionRecord {
  input: AcpStartInput;
  processKey: string;
  connectionLease: Lease<PooledAcpProcess>;
  cell: SessionCell;
  live: SessionLiveModels;
  machineStateBinding: MachineLiveStateBinding;
  lastSynced: {
    config?: SessionConfigState;
    usage?: SessionUsage | null;
    plan?: PlanState | null;
    agents?: AgentState[];
    activeTurn?: TranscriptTurn | null;
    draft?: PromptDraft | null;
    terminals?: TerminalState[];
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
  private readonly activity = new Map<string, IoActivityTracker>();
  private readonly sessionIdlePolicy: IdlePolicy;
  private readonly idleSweeper: IdleSweeper;

  constructor(
    private readonly deps: AcpRuntimeDeps & { logger: Logger },
    private readonly connections: AcpConnectionSource,
    private readonly terminals: AgentTerminalManager,
    private readonly ports: { fs: FsPort; terminals: TerminalPort }
  ) {
    this.sessionIdlePolicy = compileIdlePolicy(
      deps.lifecycle?.session ?? { kind: 'idle-after', outputMs: 60 * 60_000 }
    );
    this.idleSweeper = createIdleSweeper<string>({
      ...(deps.clock ? { clock: deps.clock } : {}),
      intervalMs: deps.lifecycle?.sweepIntervalMs ?? 60_000,
      entries: () => Array.from(this.cells.keys()),
      snapshot: (conversationId) => this.lifecycleSnapshot(conversationId),
      policy: () => this.sessionIdlePolicy,
      deactivate: (conversationId, reason) => {
        this.stop(conversationId, reason);
      },
      onError: (error, conversationId) => {
        this.deps.logger.warn('SessionManager: idle sweep failed', {
          conversationId,
          error: String(error),
        });
      },
    });
  }

  async start(input: AcpStartInput): Promise<Result<{ sessionId: string }, AcpStartSessionError>> {
    const existing = this.cells.get(input.conversationId);
    if (existing) {
      this.persistActiveIntent(input, existing.cell.acpSessionId);
      return ok({ sessionId: existing.cell.acpSessionId });
    }
    this.recordInputActivity(input.conversationId);

    this.upsertSessionSummary(input, null, {
      lifecycle: 'starting',
      isGenerating: false,
      pendingPermissionCount: 0,
      backgroundAgentCount: 0,
      queuedPromptCount: 0,
    });

    const binding = this.deps.agentHost.resolveAcp(input.providerId);
    if (!binding) {
      this.deleteSessionSummary(input.conversationId);
      return acpErr.providerUnsupported(input.providerId);
    }

    const connectionKey: AcpConnectionKey = {
      providerId: input.providerId,
      cwd: input.cwd,
    };
    const acquire = await acquireResourceAsResult(
      this.connections,
      connectionKey,
      isAcpConnectionError
    );
    if (!acquire.success) {
      this.deleteSessionSummary(input.conversationId);
      return acquire;
    }

    const acquired = acquire.data;
    const connection = acquired.value;
    let record: SessionRecord | null = null;

    try {
      if (input.sessionId && connection.supportsLoadSession && connection.agent.loadSession) {
        record = this.createRecord(input, connection, acquired, input.sessionId);
        this.addLoading(connection.key, input.conversationId);
        this.registerRoute(connection.key, input.sessionId, input.conversationId);
        record.cell.beginReplay();

        let loaded = false;
        try {
          const response = await connection.agent.loadSession(
            this.buildLoadSessionRequest(input.cwd, input.sessionId)
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
          const queueResult = this.queueInitialPrompts(record);
          if (!queueResult.success) return queueResult;
          record.cell.endReplay();
          loaded = true;
        } catch (e) {
          if (isAuthRequiredError(e)) throw e;
          this.deps.logger.warn('SessionManager: loadSession failed, starting a new session', {
            conversationId: input.conversationId,
          });
        } finally {
          this.removeLoading(connection.key, input.conversationId);
        }

        if (!loaded) {
          this.removeRecord(input.conversationId, false);
          record = null;
        }
      }

      if (!record) {
        let response;
        try {
          response = await connection.agent.newSession(this.buildNewSessionRequest(input.cwd));
        } catch (e) {
          if (isAuthRequiredError(e)) throw e;
          this.removeRecord(input.conversationId, false);
          await acquired.release();
          this.deleteSessionSummary(input.conversationId);
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
        const queueResult = this.queueInitialPrompts(record);
        if (!queueResult.success) return queueResult;
        record.cell.applySessionReady();
      }

      this.registerRoute(connection.key, record.cell.acpSessionId, input.conversationId);

      this.syncRecord(record);
      this.persistActiveIntent(input, record.cell.acpSessionId);
      return ok({ sessionId: record.cell.acpSessionId });
    } catch (e) {
      if (record) this.removeRecord(record.input.conversationId, false);
      await acquired.release();
      this.deleteSessionSummary(input.conversationId);
      if (isAuthRequiredError(e)) {
        return acpErr.authRequired(toSerializedError(e));
      }
      return acpErr.initializeFailed(toSerializedError(e));
    }
  }

  async prompt(input: SendPromptInput): Promise<Result<{ queued: boolean }, AcpSendPromptError>> {
    const record = this.cells.get(input.conversationId);
    if (!record) return acpErr.conversationNotFound(input.conversationId);
    this.recordInputActivity(input.conversationId);
    return record.cell.prompt(input.prompt);
  }

  queuePrompt(input: SendPromptInput): Result<{ queued: boolean }, AcpQueuePromptError> {
    const record = this.cells.get(input.conversationId);
    if (!record) return acpErr.conversationNotFound(input.conversationId);
    this.recordInputActivity(input.conversationId);
    const result = record.cell.queuePrompt(input.prompt);
    if (!result.success) return result;
    return ok({ queued: true });
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

  stop(conversationId: string, cause = 'user'): Result<void, AcpStopSessionError> {
    const record = this.cells.get(conversationId);
    if (record) {
      record.cell.closeSession().catch(() => {});
      this.removeRecord(conversationId, true);
    }
    this.persistSuspendedIntent(conversationId, cause);
    return ok();
  }

  kill(conversationId: string): Result<void, AcpStopSessionError> {
    const result = this.stop(conversationId, 'user');
    if (!result.success) return result;
    this.removePersistedIntent(conversationId);
    return ok();
  }

  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string
  ): Result<void, AcpResolvePermissionError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    this.recordInputActivity(conversationId);
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
    this.recordOutputActivity(conversationId);
    if (record.cell.acpSessionId !== params.sessionId) {
      record.cell.setAcpSessionId(params.sessionId);
      this.registerRoute(connection.key, params.sessionId, conversationId);
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
    this.recordOutputActivity(conversationId);
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
      record.cell.processClosed(exitCode);
      this.removeRecord(record.input.conversationId, false);
      this.deleteSessionSummary(record.input.conversationId);
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
      onClosed: () => this.removeRecord(input.conversationId, true),
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
    const machineStateBinding = bindMachineToLiveState({
      machine: cell.machine,
      liveState: live.states.state,
      project: projectSessionState,
    });
    Object.assign(record, {
      input,
      processKey: connection.key,
      connectionLease,
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
      lifecycle: state.lifecycle,
      isGenerating: state.isGenerating,
      lastStopReason: cell?.sessionState.lastStopReason ?? null,
      lastTurnErrored: cell?.sessionState.lastTurnErrored ?? false,
      pendingPermissionCount: state.pendingPermissionCount ?? state.pendingPermissions?.length ?? 0,
      backgroundAgentCount: state.backgroundAgentCount,
      queuedPromptCount: state.queuedPromptCount ?? state.queuedPrompts?.length ?? 0,
      title: cell?.transcript.title ?? null,
      updatedAt: this.now(),
    };
    const activity = this.activity.get(input.conversationId)?.snapshot();
    if (activity?.lastInputAt !== null && activity?.lastInputAt !== undefined) {
      summary.lastInputAt = activity.lastInputAt;
    }
    if (activity?.lastOutputAt !== null && activity?.lastOutputAt !== undefined) {
      summary.lastOutputAt = activity.lastOutputAt;
    }
    this.sessionsList.states.list.produce((draft) => {
      draft[input.conversationId] = summary;
    });
  }

  dispose(): void {
    this.idleSweeper.dispose();
  }

  async reconcile(): Promise<void> {
    const listed = await this.deps.intents.list();
    if (!listed.success) {
      this.deps.logger.warn('SessionManager: failed to load session intents', {
        error: listed.error,
      });
      return;
    }

    for (const intent of listed.data) {
      if (intent.status !== 'active') continue;
      const parsed = acpStartInputSchema.safeParse(intent.payload);
      const sessionId = intent.sessionId ?? (parsed.success ? parsed.data.sessionId : null);
      if (!parsed.success || !sessionId) {
        this.persistSuspendedIntent(intent.conversationId, 'reconcile-failed');
        continue;
      }

      const input: AcpStartInput = {
        ...parsed.data,
        sessionId,
        initialQueue: undefined,
      };
      const result = await this.start(input);
      if (!result.success) {
        this.deps.logger.warn('SessionManager: failed to reconcile session intent', {
          conversationId: intent.conversationId,
          error: result.error,
        });
        this.persistSuspendedIntent(intent.conversationId, 'reconcile-failed');
      }
    }
  }

  private deleteSessionSummary(conversationId: string): void {
    this.sessionsList.states.list.produce((draft) => {
      delete draft[conversationId];
    });
  }

  private activityFor(conversationId: string): IoActivityTracker {
    let tracker = this.activity.get(conversationId);
    if (!tracker) {
      tracker = createIoActivityTracker(() => this.now());
      this.activity.set(conversationId, tracker);
    }
    return tracker;
  }

  private recordInputActivity(conversationId: string): void {
    this.activityFor(conversationId).recordInput();
    this.syncSessionActivity(conversationId);
  }

  private recordOutputActivity(conversationId: string): void {
    this.activityFor(conversationId).recordOutput();
    this.syncSessionActivity(conversationId);
  }

  private syncSessionActivity(conversationId: string): void {
    const activity = this.activity.get(conversationId)?.snapshot();
    if (!activity) return;
    this.sessionsList.states.list.produce((draft) => {
      const current = draft[conversationId];
      if (!current) return;
      if (activity.lastInputAt !== null) current.lastInputAt = activity.lastInputAt;
      if (activity.lastOutputAt !== null) current.lastOutputAt = activity.lastOutputAt;
    });
  }

  private lifecycleSnapshot(conversationId: string): IoActivitySnapshot | null {
    const record = this.cells.get(conversationId);
    if (!record) return null;
    const state = record.cell.sessionState;
    const activity = this.activityFor(conversationId).snapshot();
    return {
      running: true,
      busy:
        state.isGenerating ||
        state.pendingPermissions.length > 0 ||
        state.queuedPrompts.length > 0 ||
        state.backgroundAgentCount > 0,
      attachedClients: activity.attachedClients,
      detachedAt: activity.detachedAt,
      lastInputAt: activity.lastInputAt,
      lastOutputAt: activity.lastOutputAt,
    };
  }

  private now(): number {
    return this.deps.clock?.now() ?? Date.now();
  }

  private persistActiveIntent(input: AcpStartInput, sessionId: string): void {
    const { initialQueue: _initialQueue, ...persisted } = input;
    void this.deps.intents
      .saveActive({
        conversationId: input.conversationId,
        sessionId,
        payload: { ...persisted, sessionId } as unknown as Serializable,
      })
      .then((result) => {
        if (!result.success) {
          this.deps.logger.warn('SessionManager: failed to persist active intent', {
            conversationId: input.conversationId,
            error: result.error,
          });
        }
      });
  }

  private persistSuspendedIntent(conversationId: string, cause: string): void {
    void this.deps.intents.markSuspended(conversationId, cause).then((result) => {
      if (!result.success) {
        this.deps.logger.warn('SessionManager: failed to persist suspended intent', {
          conversationId,
          error: result.error,
        });
      }
    });
  }

  private removePersistedIntent(conversationId: string): void {
    void this.deps.intents.remove(conversationId).then((result) => {
      if (!result.success) {
        this.deps.logger.warn('SessionManager: failed to remove session intent', {
          conversationId,
          error: result.error,
        });
      }
    });
  }

  private removeRecord(conversationId: string, releaseConnection: boolean): void {
    const record = this.cells.get(conversationId);
    if (!record) return;
    record.cell.dispose();
    record.machineStateBinding.dispose();
    this.unregisterRoutes(record.processKey, conversationId);
    this.cells.delete(conversationId);
    this.activity.delete(conversationId);
    this.terminals.disposeConversation(conversationId);
    record.live.dispose();
    this.deleteSessionSummary(conversationId);
    if (releaseConnection) void record.connectionLease.release();
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

  private buildNewSessionRequest(cwd: string): NewSessionRequest {
    return { cwd, mcpServers: [] };
  }

  private buildLoadSessionRequest(cwd: string, sessionId: string): LoadSessionRequest {
    return { cwd, sessionId, mcpServers: [] };
  }
}

function isAuthRequiredError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { code?: unknown; cause?: unknown };
  if (value.code === -32000) return true;
  return isAuthRequiredError(value.cause);
}
