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
import type { Result, Serializable } from '@emdash/shared';
import { err, ok, toSerializedError } from '@emdash/shared';
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
import { z } from 'zod';
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
  AcpStartError,
  ConversationNotFoundError,
  InvalidStateError,
  NormalizedEvent,
  SessionMcpServer,
  SessionState,
  SessionSummary,
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
  type AcpConnectionContext,
  type AcpConnectionEntry,
  type AcpConnectionKey,
  type AcpConnectionSource,
} from '#runtimes/acp/node/connection/source';
import { SessionCell, type AcpChatHistory } from '#runtimes/acp/node/session/cell';
import type { SessionCellCallbacks } from '#runtimes/acp/node/session/cell-deps';
import {
  closedSessionState,
  createAcpSessionLiveHost,
  createAcpSessionsLiveHost,
  createSessionsListModel,
  suspendedSessionState,
  type ActivationSnapshot,
  type AcpSessionLiveHost,
  type AcpSessionsLiveHost,
  type SessionLiveModels,
  type SessionsListModel,
} from '#runtimes/acp/node/state/live-models';
import type { SessionIntent } from '#services/session-intents/api';
import type {
  ActivityFields,
  ConversationSessionLifecycle,
  EvictOptions,
  SessionSnapshotJudgment,
} from '#services/session-lifecycle/api';
import { createSessionLifecycle } from '#services/session-lifecycle/node';
import { registrationsToAcpMcpServers, summarizeAcpMcpServers } from './mcp-servers';
import type { AcpRuntimeDeps, AcpStartInput, SendPromptInput } from './types';

const DEFAULT_ACTIVATION_DRAIN_TIMEOUT_MS = 5_000;

const retainedConfigOverridesSchema = z.object({
  model: z.string().optional(),
  effort: z.string().optional(),
});

const retainedIntentSchema = acpStartInputSchema.extend({
  configOverrides: retainedConfigOverridesSchema.optional(),
});

type ConfigDimension = 'model' | 'effort';
type ConfigOverrides = Partial<Record<ConfigDimension, string>>;

interface RetainedConversation {
  conversationId: string;
  descriptor: AcpStartInput;
  configOverrides: ConfigOverrides;
  initialQueueConsumed: boolean;
  everMaterialized: boolean;
  deleted: boolean;
  projection: SessionLiveModels;
  releaseProjection: () => void;
  materializationAbort?: AbortController;
}

interface ConnectionLeaseState {
  release: boolean;
}

interface SessionRecord {
  retained: RetainedConversation;
  input: AcpStartInput;
  resumeOutcome: 'loaded' | 'replaced-by-new' | null;
  processKey: string;
  processGeneration: number;
  connectionLeaseState: ConnectionLeaseState;
  cell: SessionCell;
  mcpServers: SessionMcpServer[];
  machineStateBinding: { dispose(): void };
  disposed: boolean;
}

type ActivationStartError = AcpStartError | ConversationNotFoundError;
type ActivationRegistry = LifecycleRegistry<
  RetainedConversation,
  SessionRecord,
  ActivationStartError,
  void,
  never
>;

export type AcpWakeFailure = {
  kind: 'wake-failed';
  error: AcpStartError;
};

export function isAcpWakeFailure(error: unknown): error is AcpWakeFailure {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    error.kind === 'wake-failed' &&
    'error' in error
  );
}

export interface HistoryPage {
  turns: TranscriptTurn[];
  nextCursor: number | null;
  unavailable?: true;
}

export class SessionManager implements InboundRouter {
  readonly sessionHost: AcpSessionLiveHost = createAcpSessionLiveHost();
  readonly sessionsHost: AcpSessionsLiveHost = createAcpSessionsLiveHost();
  readonly sessionsList: SessionsListModel = createSessionsListModel(this.sessionsHost);
  private readonly activations: ActivationRegistry;
  private readonly retained = new Map<string, RetainedConversation>();
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
      RetainedConversation,
      SessionRecord,
      ActivationStartError,
      void,
      never
    >({
      label: 'acp-session-activations',
      keyOf: (entry) => entry.conversationId,
      start: (entry, scope) => this.startActivation(entry, scope),
      interrupt: (_key, record) => this.interruptRecord(record),
      stop: async () => ok(),
      drainTimeoutMs:
        deps.lifecycle?.activationDrainTimeoutMs ?? DEFAULT_ACTIVATION_DRAIN_TIMEOUT_MS,
      onLeaseDrainTimeout: ({ key, leaseCount, timeoutMs }) => {
        this.deps.logger.warn('SessionManager: activation lease drain timed out', {
          conversationId: key,
          leakedLeases: leaseCount,
          timeoutMs,
        });
      },
      onStateChanged: (change) => this.onActivationStateChanged(change),
      onObserverError: ({ key, error }) => {
        this.deps.logger.warn('SessionManager: activation state observer failed', {
          conversationId: key,
          error: String(error),
        });
      },
    });
    this.lifecycle = createSessionLifecycle({
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
        {
          name: 'activation',
          run: async (key) => {
            await this.activations.stop(key);
          },
        },
      ],
      conversation: {
        intents: deps.intents,
        reports: deps.conversationReports,
        activePayload: (conversationId) => this.activeIntentPayload(conversationId),
        reconcile: {
          parse: (intent): { input: RetainedConversation } | { suspend: string } => {
            const entry = this.restoreRetainedIntent(intent);
            return entry ? { input: entry } : { suspend: 'reconcile-failed' };
          },
          resume: (entry) => this.startRetained(entry),
        },
      },
    });
  }

  async start(input: AcpStartInput): Promise<Result<{ sessionId: string }, AcpStartError>> {
    await this.evictions.get(input.conversationId);
    const existing = this.retained.get(input.conversationId);
    const entry = existing ?? this.createRetained(input, { suspended: false });
    this.lifecycle.recordInput(input.conversationId);

    const started = await this.activations.start(entry);
    if (!started.success) {
      if (started.error.type === 'conversation_not_found') {
        return acpErr.invalidState('ACP conversation was deleted while starting');
      }
      if (!entry.everMaterialized && this.isRetainedCurrent(entry)) {
        this.removeRetained(entry);
        await this.activations.forceRemove(entry.conversationId, started.error);
        await this.evict(entry.conversationId, { intent: 'keep' });
      } else if (this.isRetainedCurrent(entry)) {
        this.publishSuspended(entry);
      }
      return err(started.error);
    }

    if (existing) this.lifecycle.saveIntent(input.conversationId);
    return ok({ sessionId: started.data.cell.acpSessionId });
  }

  private startRetained(
    entry: RetainedConversation
  ): Promise<Result<{ sessionId: string }, AcpStartError>> {
    return this.start(entry.descriptor);
  }

  private async startActivation(
    entry: RetainedConversation,
    scope: Scope
  ): Promise<Result<SessionRecord, ActivationStartError>> {
    if (!this.isRetainedCurrent(entry)) return acpErr.conversationNotFound(entry.conversationId);
    const materializationAbort = new AbortController();
    entry.materializationAbort = materializationAbort;
    const input = this.materializationInput(entry);
    entry.projection.source.set({
      kind: 'active',
      snapshot: startingSnapshot(),
    });
    this.upsertSessionSummary(input, null, {
      lifecycle: 'starting',
      isGenerating: false,
      pendingPermissionCount: 0,
      backgroundAgentCount: 0,
      queuedPromptCount: 0,
    });

    const binding = this.deps.agentHost.resolveAcp(input.providerId);
    if (!binding) return acpErr.providerUnsupported(input.providerId);

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
    if (!acquire.success) return acquire;

    const acquired = acquire.data;
    const connectionLeaseState: ConnectionLeaseState = { release: true };
    scope.add(async () => {
      if (connectionLeaseState.release) await acquired.release();
    });
    if (!this.isRetainedCurrent(entry)) {
      return acpErr.conversationNotFound(entry.conversationId);
    }

    const connection = acquired.value;
    const mcpServers = await this.resolveSessionMcpServers(input.providerId, connection);
    const mcpServerSummary = summarizeAcpMcpServers(mcpServers);
    let record: SessionRecord | null = null;
    let resumeOutcome: 'loaded' | 'replaced-by-new' | null = input.sessionId
      ? 'replaced-by-new'
      : null;

    try {
      if (input.sessionId && connection.supportsLoadSession && connection.agent.loadSession) {
        record = this.createRecord(
          entry,
          input,
          connection,
          connectionLeaseState,
          input.sessionId,
          scope
        );
        this.addLoading(connectionOwnerId(connection), input.conversationId);
        this.registerRoute(connectionOwnerId(connection), input.sessionId, input.conversationId);
        record.cell.beginReplay();

        let loaded = false;
        try {
          const response = await abortable(
            connection.agent.loadSession(
              this.buildLoadSessionRequest(input.cwd, input.sessionId, mcpServers)
            ),
            materializationAbort.signal
          );
          if (!this.isRetainedCurrent(entry) || record.disposed) {
            return acpErr.conversationNotFound(entry.conversationId);
          }
          record.cell.applySessionLoaded({
            modes: response.modes,
            configOptions: response.configOptions,
          });
          await this.applyConfigOverrides(record, entry);
          await this.applyInitialMode(record, entry.descriptor);
          const queueResult = this.queueInitialPrompts(record, entry);
          if (!queueResult.success) return queueResult;
          record.cell.endReplay();
          loaded = true;
          resumeOutcome = 'loaded';
        } catch (error) {
          if (!this.isRetainedCurrent(entry)) {
            return acpErr.conversationNotFound(entry.conversationId);
          }
          if (isAuthRequiredError(error)) throw error;
          this.deps.logger.warn('SessionManager: loadSession failed, starting a new session', {
            conversationId: input.conversationId,
          });
        } finally {
          this.removeLoading(connectionOwnerId(connection), input.conversationId);
        }

        if (!loaded) {
          this.discardReplacedRecord(record);
          record = null;
        }
      }

      if (!record) {
        let response;
        try {
          response = await abortable(
            connection.agent.newSession(this.buildNewSessionRequest(input.cwd, mcpServers)),
            materializationAbort.signal
          );
        } catch (error) {
          if (!this.isRetainedCurrent(entry)) {
            return acpErr.conversationNotFound(entry.conversationId);
          }
          if (isAuthRequiredError(error)) throw error;
          return acpErr.newSessionFailed(toSerializedError(error));
        }
        if (!this.isRetainedCurrent(entry)) {
          return acpErr.conversationNotFound(entry.conversationId);
        }
        record = this.createRecord(
          entry,
          input,
          connection,
          connectionLeaseState,
          response.sessionId,
          scope
        );
        record.cell.applySessionMeta({
          modes: response.modes,
          configOptions: response.configOptions,
        });
        await this.applyConfigOverrides(record, entry);
        await this.applyInitialMode(record, entry.descriptor);
        const queueResult = this.queueInitialPrompts(record, entry);
        if (!queueResult.success) return queueResult;
        record.cell.applySessionReady();
      }

      this.registerRoute(
        connectionOwnerId(connection),
        record.cell.acpSessionId,
        input.conversationId
      );
      record.mcpServers = mcpServerSummary;
      record.resumeOutcome = resumeOutcome;
      entry.everMaterialized = true;
      this.updateRetainedSessionId(entry, record.cell.acpSessionId);
      this.syncRecord(record);
      return ok(record);
    } catch (error) {
      if (isAuthRequiredError(error)) return acpErr.authRequired(toSerializedError(error));
      return acpErr.initializeFailed(toSerializedError(error));
    }
  }

  async prompt(
    input: SendPromptInput
  ): Promise<Result<{ queued: boolean }, AcpSendPromptError | AcpWakeFailure>> {
    const entry = this.retained.get(input.conversationId);
    if (!entry || entry.deleted) return acpErr.conversationNotFound(input.conversationId);
    await this.evictions.get(input.conversationId);
    if (!this.isRetainedCurrent(entry)) return acpErr.conversationNotFound(input.conversationId);

    const acquired = await this.activations.acquire(entry);
    if (!acquired.success) return this.mapWakeError(acquired.error);
    const lease = acquired.data;
    try {
      if (!this.isRetainedCurrent(entry)) return acpErr.conversationNotFound(input.conversationId);
      this.lifecycle.recordInput(input.conversationId);
      if (input.placement === 'queue') {
        const state = lease.value.cell.sessionState;
        if (state.lifecycle !== 'ready' || state.isGenerating || state.queuedPrompts.length > 0) {
          const queued = lease.value.cell.queuePrompt(input.prompt);
          if (!queued.success) return queued;
          return ok({ queued: true });
        }
      }
      return await lease.value.cell.prompt(input.prompt);
    } finally {
      await lease.release();
    }
  }

  editQueuedPrompt(
    conversationId: string,
    id: string,
    input: SendPromptInput['prompt']
  ): Result<void, AcpEditQueuedPromptError> {
    const retained = this.retained.get(conversationId);
    if (!retained) return acpErr.conversationNotFound(conversationId);
    const record = this.readyRecord(conversationId);
    return record ? record.cell.editQueuedPrompt(id, input) : ok();
  }

  removeQueuedPrompt(conversationId: string, id: string): Result<void, AcpDeleteQueuedPromptError> {
    const retained = this.retained.get(conversationId);
    if (!retained) return acpErr.conversationNotFound(conversationId);
    const record = this.readyRecord(conversationId);
    return record ? record.cell.removeQueuedPrompt(id) : ok();
  }

  reorderQueue(
    conversationId: string,
    ids: readonly string[]
  ): Result<void, AcpChangeQueuePromptOrderError> {
    const retained = this.retained.get(conversationId);
    if (!retained) return acpErr.conversationNotFound(conversationId);
    const record = this.readyRecord(conversationId);
    return record ? record.cell.reorderQueue(ids) : ok();
  }

  async cancel(conversationId: string): Promise<Result<void, AcpCancelTurnError>> {
    const record = this.readyRecord(conversationId);
    return record ? record.cell.cancel() : ok();
  }

  async stop(conversationId: string, cause = 'user'): Promise<Result<void, never>> {
    await this.evict(conversationId, { cause, intent: 'suspend' });
    const entry = this.retained.get(conversationId);
    if (entry) this.publishSuspended(entry);
    return ok();
  }

  async kill(conversationId: string): Promise<Result<void, never>> {
    const entry = this.retained.get(conversationId);
    if (entry) {
      entry.deleted = true;
      entry.materializationAbort?.abort(new Error('ACP conversation killed'));
      this.retained.delete(conversationId);
      entry.projection.source.set({ kind: 'closed' });
      this.deleteSessionSummary(conversationId);
      this.interruptMaterializing(conversationId);
    }

    const inFlight = this.evictions.get(conversationId);
    if (inFlight) await inFlight;
    await this.evict(conversationId, { cause: 'user', intent: 'remove' });
    await this.activations.forceRemove(conversationId, 'conversation killed');
    entry?.releaseProjection();
    return ok();
  }

  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string
  ): Result<void, AcpResolvePermissionError> {
    const retained = this.retained.get(conversationId);
    if (!retained) return acpErr.conversationNotFound(conversationId);
    const record = this.readyRecord(conversationId);
    return record ? record.cell.resolvePermission(requestId, optionId) : ok();
  }

  async setMode(
    conversationId: string,
    modeId: string
  ): Promise<Result<void, AcpSetModeOptionError | AcpWakeFailure>> {
    const entry = this.retained.get(conversationId);
    if (!entry) return acpErr.conversationNotFound(conversationId);
    await this.evictions.get(conversationId);
    if (!this.isRetainedCurrent(entry)) return acpErr.conversationNotFound(conversationId);
    const started = await this.activations.start(entry);
    if (!started.success) return this.mapWakeError(started.error);
    const result = await this.activations.use(entry, (record) => record.cell.setMode(modeId));
    if (!result.success) {
      if (isUnambiguousStartError(result.error)) return this.mapWakeError(result.error);
      return result as Result<void, AcpSetModeOptionError>;
    }
    if (!this.isRetainedCurrent(entry)) return acpErr.conversationNotFound(conversationId);
    entry.descriptor = { ...entry.descriptor, modeId };
    this.lifecycle.saveIntent(conversationId);
    return ok();
  }

  async setConfigOption(
    conversationId: string,
    dimension: ConfigDimension,
    value: string
  ): Promise<Result<void, AcpSetModelOptionError | AcpWakeFailure>> {
    const entry = this.retained.get(conversationId);
    if (!entry) return acpErr.conversationNotFound(conversationId);
    await this.evictions.get(conversationId);
    if (!this.isRetainedCurrent(entry)) return acpErr.conversationNotFound(conversationId);
    const started = await this.activations.start(entry);
    if (!started.success) return this.mapWakeError(started.error);
    const result = await this.activations.use(entry, (record) =>
      record.cell.setConfigOption(dimension, value)
    );
    if (!result.success) {
      if (isUnambiguousStartError(result.error)) return this.mapWakeError(result.error);
      return result as Result<void, AcpSetModelOptionError>;
    }
    if (!this.isRetainedCurrent(entry)) return acpErr.conversationNotFound(conversationId);
    entry.configOverrides = { ...entry.configOverrides, [dimension]: value };
    if (dimension === 'model') entry.descriptor = { ...entry.descriptor, model: value };
    this.lifecycle.saveIntent(conversationId);
    return ok();
  }

  isRunning(conversationId: string): boolean {
    return this.activations.has(conversationId);
  }

  getChatHistory(conversationId: string): AcpChatHistory {
    return this.readyRecord(conversationId)?.cell.history() ?? { committed: [], active: null };
  }

  exportParsedTranscript(conversationId: string): Result<string, AcpExportTranscriptError> {
    const record = this.readyRecord(conversationId);
    return record
      ? ok(record.cell.exportParsedTranscript())
      : acpErr.conversationNotFound(conversationId);
  }

  exportRawAcpLog(conversationId: string): Result<string, AcpExportRawLogError> {
    const record = this.readyRecord(conversationId);
    return record ? ok(record.cell.exportRawLog()) : acpErr.conversationNotFound(conversationId);
  }

  getHistory(conversationId: string, before?: number, limit = 50): HistoryPage {
    if (this.retained.has(conversationId) && !this.readyRecord(conversationId)) {
      return { turns: [], nextCursor: null, unavailable: true };
    }
    const turns = this.getChatHistory(conversationId).committed;
    const filtered = before === undefined ? turns : turns.filter((turn) => turn.seq < before);
    const page = [...filtered].sort((a, b) => b.seq - a.seq).slice(0, limit);
    const nextCursor = page.length === limit ? page.at(-1)!.seq : null;
    return { turns: page.reverse(), nextCursor };
  }

  getSessionState(conversationId: string): SessionState {
    const record = this.readyRecord(conversationId) ?? this.materializing.get(conversationId);
    if (record && this.canPublishRecord(record)) return record.cell.sessionState;
    return this.retained.has(conversationId) ? suspendedSessionState : closedSessionState;
  }

  getTerminals(conversationId: string): TerminalState[] {
    return this.terminals.listByConversation(conversationId);
  }

  getHostTerminals(): TerminalState[] {
    return this.terminals.listAll();
  }

  getLiveModels(conversationId: string): SessionLiveModels | null {
    return this.retained.get(conversationId)?.projection ?? null;
  }

  syncTerminals(conversationId: string): void {
    const record = this.recordForCallbacks(conversationId);
    if (record) this.syncRecord(record);
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

    const record = this.recordForCallbacks(conversationId);
    if (!record) return;
    this.lifecycle.recordOutput(conversationId);
    if (record.cell.acpSessionId !== params.sessionId) {
      record.cell.setAcpSessionId(params.sessionId);
      this.registerRoute(connectionOwnerId(connection), params.sessionId, conversationId);
      this.updateRetainedSessionId(record.retained, params.sessionId);
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
    const record = conversationId ? this.recordForCallbacks(conversationId) : undefined;
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
      record.connectionLeaseState.release = false;
      record.cell.processClosed(exitCode);
      void this.stop(record.input.conversationId, 'process-exited');
      void this.connections.invalidate({
        providerId: record.input.providerId,
        cwd: record.input.cwd,
      });
    }
  }

  async dispose(): Promise<void> {
    this.lifecycle.dispose();
    await this.activations.dispose();
    for (const entry of this.retained.values()) {
      entry.projection.source.set({ kind: 'closed' });
      entry.releaseProjection();
    }
    this.retained.clear();
    await Promise.all([this.sessionHost.dispose(), this.sessionsHost.dispose()]);
  }

  async reconcile(): Promise<void> {
    const listed = await this.deps.intents.list();
    if (listed.success) {
      for (const intent of listed.data) {
        if (intent.status !== 'suspended') continue;
        this.restoreRetainedIntent(intent);
      }
    } else {
      this.deps.logger.warn('SessionManager: failed to restore suspended session intents', {
        error: listed.error,
      });
    }
    await this.lifecycle.reconcile();
  }

  /** Deterministic lifecycle sweep seam used by runtime tests. */
  sweepNow(): Promise<void> {
    return this.lifecycle.sweepNow();
  }

  private createRecord(
    retained: RetainedConversation,
    input: AcpStartInput,
    connection: AcpConnectionEntry,
    connectionLeaseState: ConnectionLeaseState,
    acpSessionId: string,
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
      onClosed: () => {
        const record = recordRef.current;
        if (!record || !this.isCurrentRecord(record)) return;
        void this.stop(input.conversationId, 'process-exited');
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
      retained,
      input,
      resumeOutcome: null,
      processKey: connection.key,
      processGeneration: connection.generation,
      connectionLeaseState,
      cell,
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

  private queueInitialPrompts(
    record: SessionRecord,
    entry: RetainedConversation
  ): Result<void, InvalidStateError> {
    if (entry.initialQueueConsumed) return ok();
    for (const prompt of entry.descriptor.initialQueue ?? []) {
      const result = record.cell.queuePrompt(prompt);
      if (!result.success) return result;
    }
    entry.initialQueueConsumed = true;
    return ok();
  }

  private async applyConfigOverrides(
    record: SessionRecord,
    entry: RetainedConversation
  ): Promise<void> {
    for (const dimension of ['model', 'effort'] as const) {
      const value = entry.configOverrides[dimension];
      if (!value) continue;
      const result = await record.cell.setConfigOption(dimension, value);
      if (!result.success) {
        this.deps.logger.warn('SessionManager: failed to apply retained config option', {
          conversationId: entry.conversationId,
          providerId: entry.descriptor.providerId,
          dimension,
          error: result.error,
        });
      }
    }
  }

  private syncRecord(record: SessionRecord): void {
    if (!this.canPublishRecord(record)) return;
    record.retained.projection.source.set({ kind: 'active', snapshot: this.buildSnapshot(record) });
    this.upsertSessionSummary(record.input, record.cell, record.cell.sessionState);
  }

  private buildSnapshot(record: SessionRecord): ActivationSnapshot {
    return {
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
      suspended?: true;
    }
  ): void {
    const summary: Omit<SessionSummary, 'updatedAt'> = {
      conversationId: input.conversationId,
      providerId: input.providerId,
      cwd: input.cwd,
      lifecycle: state.lifecycle,
      ...(state.suspended ? { suspended: true as const } : {}),
      isGenerating: state.isGenerating,
      lastStopReason: cell?.sessionState.lastStopReason ?? null,
      lastTurnErrored: cell?.sessionState.lastTurnErrored ?? false,
      pendingPermissionCount: state.pendingPermissionCount ?? state.pendingPermissions?.length ?? 0,
      backgroundAgentCount: state.backgroundAgentCount,
      queuedPromptCount: state.queuedPromptCount ?? state.queuedPrompts?.length ?? 0,
      title: cell?.transcript.title ?? null,
    };
    const activity = this.lifecycle.activity(input.conversationId);
    if (activity.lastInputAt !== null) summary.lastInputAt = activity.lastInputAt;
    if (activity.lastOutputAt !== null) summary.lastOutputAt = activity.lastOutputAt;
    this.sessionsList.states.list.update((previous) => {
      const current = previous[input.conversationId];
      if (current && sessionSummaryEquals(current, summary)) return previous;
      return produce(previous, (draft) => {
        draft[input.conversationId] = { ...summary, updatedAt: this.clock.now() };
      });
    });
  }

  private publishSuspended(entry: RetainedConversation): void {
    if (!this.isRetainedCurrent(entry)) return;
    entry.projection.source.set({ kind: 'suspended' });
    this.upsertSessionSummary(entry.descriptor, null, {
      lifecycle: 'closed',
      suspended: true,
      isGenerating: false,
      pendingPermissionCount: 0,
      backgroundAgentCount: 0,
      queuedPromptCount: 0,
    });
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
    const record = this.readyRecord(conversationId);
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

  private createRetained(
    input: AcpStartInput,
    options: { suspended: boolean; configOverrides?: ConfigOverrides; consumed?: boolean } = {
      suspended: false,
    }
  ): RetainedConversation {
    const projection = this.sessionHost.models(input.conversationId);
    const releaseProjection = this.sessionHost.models.retain(input.conversationId);
    const entry: RetainedConversation = {
      conversationId: input.conversationId,
      descriptor: input,
      configOverrides: options.configOverrides ?? (input.model ? { model: input.model } : {}),
      initialQueueConsumed: options.consumed ?? false,
      everMaterialized: options.suspended,
      deleted: false,
      projection,
      releaseProjection,
    };
    this.retained.set(input.conversationId, entry);
    if (options.suspended) this.publishSuspended(entry);
    return entry;
  }

  private removeRetained(entry: RetainedConversation): void {
    if (!this.isRetainedCurrent(entry)) return;
    entry.deleted = true;
    entry.materializationAbort?.abort(new Error('ACP conversation removed'));
    this.retained.delete(entry.conversationId);
    entry.projection.source.set({ kind: 'closed' });
    this.deleteSessionSummary(entry.conversationId);
    entry.releaseProjection();
  }

  private restoreRetainedIntent(intent: SessionIntent): RetainedConversation | null {
    const parsed = retainedIntentSchema.safeParse(intent.payload);
    const sessionId = intent.sessionId ?? (parsed.success ? parsed.data.sessionId : null);
    if (!parsed.success || !sessionId) return null;
    const existing = this.retained.get(intent.conversationId);
    if (existing) return existing;
    const { configOverrides, ...input } = parsed.data;
    return this.createRetained(
      { ...input, conversationId: intent.conversationId, sessionId, initialQueue: undefined },
      {
        suspended: true,
        configOverrides: configOverrides ?? (input.model ? { model: input.model } : {}),
        consumed: true,
      }
    );
  }

  private activeIntentPayload(
    conversationId: string
  ): { payload: Serializable; sessionId?: string | null } | null {
    const entry = this.retained.get(conversationId);
    if (!entry || entry.deleted) return null;
    const { initialQueue: _initialQueue, ...persisted } = entry.descriptor;
    return {
      payload: {
        ...persisted,
        ...(Object.keys(entry.configOverrides).length > 0
          ? { configOverrides: entry.configOverrides }
          : {}),
      } as unknown as Serializable,
      sessionId: entry.descriptor.sessionId,
    };
  }

  private materializationInput(entry: RetainedConversation): AcpStartInput {
    return {
      ...entry.descriptor,
      initialQueue: entry.initialQueueConsumed ? undefined : entry.descriptor.initialQueue,
    };
  }

  private updateRetainedSessionId(entry: RetainedConversation, sessionId: string): void {
    if (!this.isRetainedCurrent(entry) || entry.descriptor.sessionId === sessionId) return;
    entry.descriptor = { ...entry.descriptor, sessionId };
    if (entry.everMaterialized) this.lifecycle.saveIntent(entry.conversationId);
  }

  private readyRecord(conversationId: string): SessionRecord | undefined {
    const state = this.activations.state(conversationId);
    return state.kind === 'ready' ? state.value : undefined;
  }

  private recordForCallbacks(conversationId: string): SessionRecord | undefined {
    return this.readyRecord(conversationId) ?? this.materializing.get(conversationId);
  }

  private isRetainedCurrent(entry: RetainedConversation): boolean {
    return !entry.deleted && this.retained.get(entry.conversationId) === entry;
  }

  private isCurrentRecord(record: SessionRecord): boolean {
    if (record.disposed || !this.isRetainedCurrent(record.retained)) return false;
    if (this.materializing.get(record.input.conversationId) === record) return true;
    const state = this.activations.state(record.input.conversationId);
    return (
      (state.kind === 'ready' || state.kind === 'stopping' || state.kind === 'stop-failed') &&
      state.value === record
    );
  }

  private canPublishRecord(record: SessionRecord): boolean {
    if (record.disposed || !this.isRetainedCurrent(record.retained)) return false;
    if (this.materializing.get(record.input.conversationId) === record) return true;
    const state = this.activations.state(record.input.conversationId);
    return state.kind === 'ready' && state.value === record;
  }

  private interruptRecord(record: SessionRecord): void {
    void record.cell.cancel().catch((error) => {
      this.deps.logger.warn('SessionManager: failed to cancel session during teardown', {
        conversationId: record.input.conversationId,
        error: String(error),
      });
    });
    void record.cell.closeSession().catch((error) => {
      this.deps.logger.warn('SessionManager: failed to close provider session during teardown', {
        conversationId: record.input.conversationId,
        error: String(error),
      });
    });
  }

  private interruptMaterializing(conversationId: string): void {
    const record = this.materializing.get(conversationId);
    if (record) this.interruptRecord(record);
  }

  private async teardownRecord(record: SessionRecord): Promise<void> {
    if (record.disposed) return;
    record.disposed = true;
    record.cell.dispose();
    record.machineStateBinding.dispose();
    this.unregisterRoutes(connectionOwnerId(record), record.input.conversationId);
    if (this.materializing.get(record.input.conversationId) === record) {
      this.materializing.delete(record.input.conversationId);
    }
    this.terminals.disposeConversation(record.input.conversationId);
  }

  private discardReplacedRecord(record: SessionRecord): void {
    void this.teardownRecord(record);
  }

  private onActivationStateChanged(
    change: LifecycleRegistryStateChange<SessionRecord, ActivationStartError, never>
  ): void {
    switch (change.current.kind) {
      case 'ready': {
        const record = change.current.value;
        record.retained.materializationAbort = undefined;
        if (this.materializing.get(change.key) === record) this.materializing.delete(change.key);
        if (!this.isRetainedCurrent(record.retained)) return;
        this.lifecycle.started(change.key, {
          conversationId: change.key,
          providerSessionId: record.cell.acpSessionId,
          resumeOutcome: record.resumeOutcome,
        });
        return;
      }
      case 'stopping': {
        const entry = this.retained.get(change.key);
        if (entry) this.publishSuspended(entry);
        return;
      }
      case 'idle':
      case 'start-failed': {
        const entry = this.retained.get(change.key);
        if (entry) entry.materializationAbort = undefined;
        if (entry?.everMaterialized) this.publishSuspended(entry);
        else entry?.projection.source.set({ kind: 'closed' });
        return;
      }
      case 'disposed': {
        const entry = this.retained.get(change.key);
        entry?.projection.source.set({ kind: 'closed' });
        return;
      }
      case 'starting':
      case 'stop-failed':
        return;
    }
  }

  private mapWakeError<E>(error: ActivationStartError): Result<never, E | AcpWakeFailure> {
    if (error.type === 'conversation_not_found') return err(error) as Result<never, E>;
    return err({ kind: 'wake-failed', error });
  }

  private resolveConversationForSession(processOwner: string, acpSessionId: string): string | null {
    const route = this.routes.get(processOwner)?.get(acpSessionId);
    if (route) return route;
    const loading = this.loadingConversations.get(processOwner);
    const pending = loading?.values().next().value;
    if (!pending) return null;
    this.registerRoute(processOwner, acpSessionId, pending);
    return pending;
  }

  private registerRoute(processOwner: string, acpSessionId: string, conversationId: string): void {
    let bySession = this.routes.get(processOwner);
    if (!bySession) {
      bySession = new Map();
      this.routes.set(processOwner, bySession);
    }
    bySession.set(acpSessionId, conversationId);
  }

  private unregisterRoutes(processOwner: string, conversationId: string): void {
    const bySession = this.routes.get(processOwner);
    if (!bySession) return;
    for (const [sessionId, mappedConversationId] of bySession) {
      if (mappedConversationId === conversationId) bySession.delete(sessionId);
    }
    if (bySession.size === 0) this.routes.delete(processOwner);
  }

  private addLoading(processOwner: string, conversationId: string): void {
    let loading = this.loadingConversations.get(processOwner);
    if (!loading) {
      loading = new Set();
      this.loadingConversations.set(processOwner, loading);
    }
    loading.add(conversationId);
  }

  private removeLoading(processOwner: string, conversationId: string): void {
    const loading = this.loadingConversations.get(processOwner);
    if (!loading) return;
    loading.delete(conversationId);
    if (loading.size === 0) this.loadingConversations.delete(processOwner);
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

function startingSnapshot(): ActivationSnapshot {
  return {
    state: { ...closedSessionState, lifecycle: 'starting' },
    config: initialSessionConfigState,
    usage: null,
    plan: null,
    agents: [],
    activeTurn: null,
    terminals: [],
    mcpServers: [],
  };
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
    current.suspended === candidate.suspended &&
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

function isUnambiguousStartError(error: unknown): error is ActivationStartError {
  if (typeof error !== 'object' || error === null || !('type' in error)) return false;
  return [
    'provider_unsupported',
    'auth_required',
    'spawn_failed',
    'initialize_failed',
    'new_session_failed',
  ].includes(String(error.type));
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

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
