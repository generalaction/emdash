import type {
  Client,
  CreateTerminalRequest,
  CreateTerminalResponse,
  LoadSessionRequest,
  NewSessionRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import type {
  AcpRuntimeError,
  AgentState,
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
} from '@emdash/core/acp';
import { acpErr } from '@emdash/core/acp';
import type { Result } from '@emdash/shared';
import { isErr, ok, toSerializedError } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { AgentTerminalManager } from '../agent-terminal-manager';
import type { FsPort, TerminalPort } from '../client-ports';
import { buildClientHandler, type InboundRouter } from '../connection/client-handler';
import type { ConnectionPool, ConnectionPoolEntry } from '../connection/pool';
import { SessionCell, type AcpChatHistory } from '../session/cell';
import type { SessionCellCallbacks } from '../session/cell-deps';
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
} from '../state/live-models';
import type { AcpRuntimeDeps, AcpStartInput, SendPromptInput } from './types';

interface SessionRecord {
  input: AcpStartInput;
  processKey: string;
  cell: SessionCell;
  live: SessionLiveModels;
  lastSynced: {
    sessionState?: SessionState;
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

  constructor(
    private readonly deps: AcpRuntimeDeps & { logger: Logger },
    private readonly pool: ConnectionPool,
    private readonly terminals: AgentTerminalManager,
    private readonly ports: { fs: FsPort; terminals: TerminalPort }
  ) {}

  async start(input: AcpStartInput): Promise<Result<{ sessionId: string }, AcpRuntimeError>> {
    const existing = this.cells.get(input.conversationId);
    if (existing) return ok({ sessionId: existing.cell.acpSessionId });

    this.upsertSessionSummary(input, null, {
      lifecycle: 'starting',
      isGenerating: false,
      pendingPermissionCount: 0,
      backgroundAgentCount: 0,
      queuedPromptCount: 0,
    });

    const binding = this.deps.pluginHost.resolveAcp(input.providerId);
    if (!binding) {
      this.deleteSessionSummary(input.conversationId);
      return acpErr.providerUnsupported(input.providerId);
    }

    const acquire = await this.pool.acquire({
      providerId: input.providerId,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      behavior: binding.behavior,
      buildClient: (_agent, key): Client =>
        buildClientHandler(() => this.pool.get(key), this, this.ports),
    });
    if (isErr(acquire)) {
      this.deleteSessionSummary(input.conversationId);
      return acquire;
    }

    const connection = acquire.data;
    let record: SessionRecord | null = null;

    try {
      if (input.sessionId && connection.supportsLoadSession && connection.agent.loadSession) {
        record = this.createRecord(input, connection, input.sessionId);
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
        const response = await connection.agent.newSession(this.buildNewSessionRequest(input.cwd));
        record = this.createRecord(input, connection, response.sessionId);
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
      void this.deps
        .persistSessionId(input.conversationId, record.cell.acpSessionId)
        .catch(() => {});

      this.syncRecord(record);
      return ok({ sessionId: record.cell.acpSessionId });
    } catch (e) {
      if (record) this.removeRecord(record.input.conversationId, false);
      this.pool.release(connection.key);
      this.deleteSessionSummary(input.conversationId);
      if (isAuthRequiredError(e)) {
        return acpErr.authRequired(toSerializedError(e));
      }
      return acpErr.initializeFailed(toSerializedError(e));
    }
  }

  async prompt(input: SendPromptInput): Promise<Result<{ queued: boolean }, AcpRuntimeError>> {
    const record = this.cells.get(input.conversationId);
    if (!record) return acpErr.conversationNotFound(input.conversationId);
    return record.cell.prompt(input.prompt);
  }

  queuePrompt(input: SendPromptInput): Result<{ queued: boolean }, AcpRuntimeError> {
    const record = this.cells.get(input.conversationId);
    if (!record) return acpErr.conversationNotFound(input.conversationId);
    const result = record.cell.queuePrompt(input.prompt);
    if (!result.success) return result;
    return ok({ queued: true });
  }

  editQueuedPrompt(
    conversationId: string,
    id: string,
    input: SendPromptInput['prompt']
  ): Result<void, AcpRuntimeError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.editQueuedPrompt(id, input);
  }

  removeQueuedPrompt(conversationId: string, id: string): Result<void, AcpRuntimeError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.removeQueuedPrompt(id);
  }

  reorderQueue(conversationId: string, ids: readonly string[]): Result<void, AcpRuntimeError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.reorderQueue(ids);
  }

  async cancel(conversationId: string): Promise<Result<void, AcpRuntimeError>> {
    const record = this.cells.get(conversationId);
    if (!record) return ok();
    return record.cell.cancel();
  }

  setPromptDraft(conversationId: string, draft: PromptDraftUpdate): Result<void, AcpRuntimeError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.setPromptDraft(draft);
  }

  stop(conversationId: string): Result<void, AcpRuntimeError> {
    const record = this.cells.get(conversationId);
    if (!record) return ok();
    record.cell.closeSession().catch(() => {});
    this.removeRecord(conversationId, true);
    return ok();
  }

  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string
  ): Result<void, AcpRuntimeError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.resolvePermission(requestId, optionId);
  }

  async setMode(conversationId: string, modeId: string): Promise<Result<void, AcpRuntimeError>> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return record.cell.setMode(modeId);
  }

  async setConfigOption(
    conversationId: string,
    dimension: 'model' | 'effort',
    value: string
  ): Promise<Result<void, AcpRuntimeError>> {
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

  exportParsedTranscript(conversationId: string): Result<string, AcpRuntimeError> {
    const record = this.cells.get(conversationId);
    if (!record) return acpErr.conversationNotFound(conversationId);
    return ok(record.cell.exportParsedTranscript());
  }

  exportRawAcpLog(conversationId: string): Result<string, AcpRuntimeError> {
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
    connection: ConnectionPoolEntry,
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
    connection: ConnectionPoolEntry,
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const conversationId = this.resolveConversationForSession(connection.key, params.sessionId);
    const record = conversationId ? this.cells.get(conversationId) : undefined;
    if (!record) return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    const response = record.cell.requestPermission(params);
    this.syncRecord(record);
    return response;
  }

  onCreateTerminal(
    connection: ConnectionPoolEntry,
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
    }
    this.pool.forgetClosed(processKey);
  }

  private createRecord(
    input: AcpStartInput,
    connection: ConnectionPoolEntry,
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
      projectId: input.projectId,
      taskId: input.taskId,
      providerId: input.providerId,
      acpSessionId,
      agent: connection.agent,
      resolveAttachment: this.deps.resolveAttachment,
      logger: this.deps.logger,
      callbacks,
    });
    Object.assign(record, {
      input,
      processKey: connection.key,
      cell,
      live: createSessionLiveModels(this.sessionHost, input.conversationId, cell.sessionState),
      lastSynced: {
        sessionState: cell.sessionState,
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

  private queueInitialPrompts(record: SessionRecord): Result<void, AcpRuntimeError> {
    for (const prompt of record.input.initialQueue ?? []) {
      const result = record.cell.queuePrompt(prompt);
      if (!result.success) return result;
    }
    return ok();
  }

  private syncRecord(record: SessionRecord): void {
    const state = record.cell.sessionState;
    publishLiveModelState(record.live.states.state, state, record.lastSynced.sessionState);
    record.lastSynced.sessionState = state;

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
      projectId: input.projectId,
      taskId: input.taskId,
      providerId: input.providerId,
      lifecycle: state.lifecycle,
      isGenerating: state.isGenerating,
      lastStopReason: cell?.sessionState.lastStopReason ?? null,
      pendingPermissionCount: state.pendingPermissionCount ?? state.pendingPermissions?.length ?? 0,
      backgroundAgentCount: state.backgroundAgentCount,
      queuedPromptCount: state.queuedPromptCount ?? state.queuedPrompts?.length ?? 0,
      title: cell?.transcript.title ?? null,
      updatedAt: Date.now(),
    };
    this.sessionsList.states.list.produce((draft) => {
      draft[input.conversationId] = summary;
    });
  }

  private deleteSessionSummary(conversationId: string): void {
    this.sessionsList.states.list.produce((draft) => {
      delete draft[conversationId];
    });
  }

  private removeRecord(conversationId: string, releaseConnection: boolean): void {
    const record = this.cells.get(conversationId);
    if (!record) return;
    record.cell.dispose();
    this.unregisterRoutes(record.processKey, conversationId);
    this.cells.delete(conversationId);
    this.terminals.disposeConversation(conversationId);
    record.live.dispose();
    this.deleteSessionSummary(conversationId);
    if (releaseConnection) this.pool.release(record.processKey);
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
