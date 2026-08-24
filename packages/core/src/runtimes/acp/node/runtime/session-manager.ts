import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import type { Result, Serializable } from '@emdash/shared';
import { err, ok } from '@emdash/shared';
import {
  createLifecycleRegistry,
  type LifecycleRegistry,
  type LifecycleRegistryStateChange,
  type Scope,
} from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
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
  NormalizedEvent,
  SessionState,
  TerminalState,
  TranscriptTurn,
} from '#runtimes/acp/api';
import { acpErr, acpStartInputSchema, initialSessionConfigState } from '#runtimes/acp/api';
import type { FsPort } from '#runtimes/acp/node/agent-ports/fs-port';
import type { AgentTerminalManager } from '#runtimes/acp/node/agent-ports/terminal-manager';
import type { TerminalPort } from '#runtimes/acp/node/agent-ports/terminal-port';
import type {
  AcpConnectionContext,
  AcpConnectionSource,
} from '#runtimes/acp/node/connection/source';
import type { AcpChatHistory, SessionCell } from '#runtimes/acp/node/session/cell';
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
import type {
  ConfigDimension,
  ConfigOverrides,
  RetainedConversation,
  SessionRecord,
} from './conversation-types';
import { SessionMaterializer } from './session-materializer';
import { connectionRouteOwnerId, SessionRouter } from './session-router';
import { SessionsListProjector } from './sessions-list-projector';
import type { AcpRuntimeDeps, AcpStartInput, SendPromptInput } from './types';

const DEFAULT_ACTIVATION_DRAIN_TIMEOUT_MS = 5_000;

const retainedConfigOverridesSchema = z.object({
  model: z.string().optional(),
  effort: z.string().optional(),
});

const retainedIntentSchema = acpStartInputSchema.extend({
  configOverrides: retainedConfigOverridesSchema.optional(),
});

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

export class SessionManager {
  readonly sessionHost: AcpSessionLiveHost = createAcpSessionLiveHost();
  readonly sessionsHost: AcpSessionsLiveHost = createAcpSessionsLiveHost();
  readonly sessionsList: SessionsListModel = createSessionsListModel(this.sessionsHost);
  readonly router: SessionRouter;
  private readonly activations: ActivationRegistry;
  private readonly retained = new Map<string, RetainedConversation>();
  private readonly materializing = new Map<string, SessionRecord>();
  private readonly evictions = new Map<string, Promise<void>>();
  private readonly routes: Map<string, Map<string, string>>;
  private readonly loadingConversations: Map<string, Set<string>>;
  private readonly clock: Clock;
  private readonly lifecycle: ConversationSessionLifecycle;
  private readonly listProjector: SessionsListProjector;
  private readonly materializer: SessionMaterializer;

  constructor(
    private readonly deps: AcpRuntimeDeps & { logger: Logger },
    private readonly connections: AcpConnectionSource,
    private readonly terminals: AgentTerminalManager,
    private readonly ports: { fs: FsPort; terminals: TerminalPort }
  ) {
    this.clock = deps.clock ?? systemClock;
    this.router = new SessionRouter(
      {
        onSessionUpdate: (conversationId, connection, params, event) =>
          this.handleSessionUpdate(conversationId, connection, params, event),
        onPermissionRequest: (conversationId, connection, params) =>
          this.handlePermissionRequest(conversationId, connection, params),
        onCreateTerminal: (conversationId, connection, params) =>
          this.handleCreateTerminal(conversationId, connection, params),
      },
      deps.logger
    );
    this.routes = this.router.routes;
    this.loadingConversations = this.router.loadingConversations;
    this.listProjector = new SessionsListProjector(
      this.sessionsList,
      this.clock,
      (conversationId) => this.lifecycle.activity(conversationId)
    );
    this.materializer = new SessionMaterializer(deps, connections, {
      isCurrent: (entry) => this.isRetainedCurrent(entry),
      onRecordCreated: (record, scope) => {
        this.materializing.set(record.input.conversationId, record);
        this.syncRecord(record);
        record.machineStateBinding.dispose = record.cell.machine.subscribe(() =>
          this.syncRecord(record)
        );
        scope.add(() => this.teardownRecord(record));
      },
      onRecordChanged: (record) => this.syncRecord(record),
      onRecordClosed: (record) => {
        if (!this.isCurrentRecord(record)) return;
        void this.stop(record.input.conversationId, 'process-exited');
      },
      discardRecord: (record) => this.discardReplacedRecord(record),
      registerRoute: (processOwner, acpSessionId, conversationId) =>
        this.router.register(processOwner, acpSessionId, conversationId),
      addLoading: (processOwner, conversationId) =>
        this.router.addLoading(processOwner, conversationId),
      removeLoading: (processOwner, conversationId) =>
        this.router.removeLoading(processOwner, conversationId),
    });
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
    this.listProjector.upsert(input, null, {
      lifecycle: 'starting',
      isGenerating: false,
      pendingPermissionCount: 0,
      backgroundAgentCount: 0,
      queuedPromptCount: 0,
    });

    const materialized = await this.materializer.materialize(
      entry,
      input,
      scope,
      materializationAbort.signal
    );
    if (!materialized.success) return materialized;

    const { record } = materialized.data;
    entry.initialQueueConsumed = materialized.data.initialQueueConsumed;
    entry.everMaterialized = true;
    this.updateRetainedSessionId(entry, record.cell.acpSessionId);
    this.syncRecord(record);
    return ok(record);
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

  private handleSessionUpdate(
    conversationId: string,
    connection: AcpConnectionContext,
    params: SessionNotification,
    event: NormalizedEvent
  ): void {
    const record = this.recordForCallbacks(conversationId);
    if (!record) return;
    this.lifecycle.recordOutput(conversationId);
    if (record.cell.acpSessionId !== params.sessionId) {
      record.cell.setAcpSessionId(params.sessionId);
      this.router.register(connectionRouteOwnerId(connection), params.sessionId, conversationId);
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

  private handlePermissionRequest(
    conversationId: string,
    _connection: AcpConnectionContext,
    params: RequestPermissionRequest
  ): Promise<RequestPermissionResponse> {
    const record = this.recordForCallbacks(conversationId);
    if (!record) return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    this.lifecycle.recordOutput(conversationId);
    const response = record.cell.requestPermission(params);
    this.syncRecord(record);
    return response;
  }

  private handleCreateTerminal(
    conversationId: string,
    connection: AcpConnectionContext,
    params: CreateTerminalRequest
  ): Promise<CreateTerminalResponse> {
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

  private syncRecord(record: SessionRecord): void {
    if (!this.canPublishRecord(record)) return;
    record.retained.projection.source.set({ kind: 'active', snapshot: this.buildSnapshot(record) });
    this.listProjector.upsert(record.input, record.cell, record.cell.sessionState);
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

  private publishSuspended(entry: RetainedConversation): void {
    if (!this.isRetainedCurrent(entry)) return;
    entry.projection.source.set({ kind: 'suspended' });
    this.listProjector.suspend(entry.descriptor);
  }

  private deleteSessionSummary(conversationId: string): void {
    this.listProjector.remove(conversationId);
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
    this.listProjector.syncActivity(conversationId, activity);
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
    this.router.unregister(recordRouteOwnerId(record), record.input.conversationId);
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

function recordRouteOwnerId(record: SessionRecord): string {
  return `${record.processKey}:${record.processGeneration}`;
}
