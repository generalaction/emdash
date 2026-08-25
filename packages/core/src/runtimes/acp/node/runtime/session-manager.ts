import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  SessionUpdate,
} from '@agentclientprotocol/sdk';
import type { Result } from '@emdash/shared';
import { err, ok } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
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
  HistoryPage,
  NormalizedEvent,
  SessionState,
  TerminalState,
} from '#runtimes/acp/api';
import { ACP_UNAMBIGUOUS_START_ERROR_TYPES, acpErr, acpStartInputSchema } from '#runtimes/acp/api';
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
  suspendedSessionState,
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
import { ConversationHandle } from './conversation-handle';
import type {
  ActivationStartError,
  ConfigDimension,
  ConfigOverrides,
  SessionRecord,
} from './conversation-types';
import { SessionMaterializer } from './session-materializer';
import { routeOwnerId, SessionRouter } from './session-router';
import { SessionsListProjector, type SuspendedIntentListEntry } from './sessions-list-projector';
import type { AcpRuntimeDeps, AcpStartInput, SendPromptInput } from './types';

const DEFAULT_ACTIVATION_DRAIN_TIMEOUT_MS = 5_000;

const retainedConfigOverridesSchema = z.object({
  model: z.string().optional(),
  effort: z.string().optional(),
});

const retainedIntentSchema = acpStartInputSchema.extend({
  configOverrides: retainedConfigOverridesSchema.optional(),
});

export type AcpWakeFailure = {
  kind: 'wake-failed';
  error: AcpStartError;
};

export type SessionManagerInspection = {
  retained: string[];
  indexedSuspended: string[];
  running: string[];
  materializing: string[];
  pendingEvictions: string[];
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

type SuspendedIntentEntry = {
  descriptor: AcpStartInput;
  configOverrides: ConfigOverrides;
  summary: SuspendedIntentListEntry;
};

export class SessionManager {
  readonly sessionHost: AcpSessionLiveHost = createAcpSessionLiveHost();
  readonly sessionsHost: AcpSessionsLiveHost = createAcpSessionsLiveHost();
  readonly sessionsList: SessionsListModel = this.sessionsHost.model;
  readonly router: SessionRouter;
  private readonly retained = new Map<string, ConversationHandle>();
  private readonly suspendedIntents = new Map<string, SuspendedIntentEntry>();
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
    this.listProjector = new SessionsListProjector(
      this.sessionsList,
      this.clock,
      (conversationId) => this.lifecycle.activity(conversationId)
    );
    this.materializer = new SessionMaterializer(deps, connections, {
      isCurrent: (entry, epoch) => entry.isEpochCurrent(epoch),
      onRecordCreated: (record, scope) => {
        record.conversation.attachProvisional(record);
        scope.add(() => this.teardownRecord(record));
      },
      onRecordChanged: (record) => record.conversation.syncRecord(record),
      onRecordClosed: (record) => {
        if (!record.conversation.isCurrentRecord(record)) return;
        void this.stop(record.input.conversationId, 'process-exited');
      },
      discardRecord: (record) => {
        record.conversation.discardProvisional(record);
        this.discardReplacedRecord(record);
      },
      registerRoute: (processOwner, acpSessionId, conversationId) =>
        this.router.register(processOwner, acpSessionId, conversationId),
      addLoading: (processOwner, conversationId) =>
        this.router.addLoading(processOwner, conversationId),
      removeLoading: (processOwner, conversationId) =>
        this.router.removeLoading(processOwner, conversationId),
    });
    this.lifecycle = createSessionLifecycle({
      name: 'SessionManager',
      logger: deps.logger,
      clock: this.clock,
      idlePolicy: deps.lifecycle?.session,
      sweepIntervalMs: deps.lifecycle?.sweepIntervalMs,
      entries: () => this.runningConversationIds(),
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
            await this.retained.get(key)?.stopActivation();
          },
        },
      ],
      conversation: {
        intents: deps.intents,
        reports: deps.conversationReports,
        activePayload: (conversationId) => this.activeIntentPayload(conversationId),
        reconcile: {
          parse: (intent): { input: ConversationHandle } | { suspend: string } => {
            const entry = this.restoreActiveIntent(intent);
            return entry ? { input: entry } : { suspend: 'reconcile-failed' };
          },
          resume: (entry) => this.startRetained(entry),
        },
      },
    });
  }

  async start(input: AcpStartInput): Promise<Result<{ sessionId: string }, AcpStartError>> {
    await this.retained.get(input.conversationId)?.waitForEviction();
    const existing = this.getOrRestoreHandle(input.conversationId);
    const entry = existing ?? this.createHandle(input, { suspended: false });
    this.lifecycle.recordInput(input.conversationId);

    const started = await entry.ensure();
    if (!started.success) {
      if (started.error.type === 'conversation_not_found') {
        return acpErr.invalidState('ACP conversation was deleted while starting');
      }
      if (!entry.everMaterialized && entry.state !== 'killed') {
        entry.kill(started.error);
        await entry.forceRemove(started.error);
        this.removeHandle(entry);
        await this.evict(entry.conversationId, { intent: 'keep' });
      } else if (entry.state !== 'killed') {
        entry.suspend();
      }
      return err(started.error);
    }

    if (existing) entry.saveIntent();
    return ok({ sessionId: started.data.cell.acpSessionId });
  }

  private startRetained(
    entry: ConversationHandle
  ): Promise<Result<{ sessionId: string }, AcpStartError>> {
    return this.start(entry.descriptor);
  }

  private async startActivation(
    entry: ConversationHandle,
    scope: Scope
  ): Promise<Result<SessionRecord, ActivationStartError>> {
    const materialization = entry.beginMaterialization();
    if (!materialization) return acpErr.conversationNotFound(entry.conversationId);
    const input = entry.materializationInput();

    const materialized = await this.materializer.materialize(
      entry,
      input,
      materialization.epoch,
      scope,
      materialization.signal
    );
    if (!materialized.success) return materialized;

    const { record } = materialized.data;
    entry.markMaterialized(record, materialized.data.initialQueueConsumed);
    return ok(record);
  }

  async prompt(
    input: SendPromptInput
  ): Promise<Result<{ queued: boolean }, AcpSendPromptError | AcpWakeFailure>> {
    const entry = this.getOrRestoreHandle(input.conversationId);
    if (!entry || entry.deleted) return acpErr.conversationNotFound(input.conversationId);
    await entry.waitForEviction();
    if (!entry.isCurrent()) return acpErr.conversationNotFound(input.conversationId);

    const acquired = await entry.acquire();
    if (!acquired.success) return this.mapWakeError(acquired.error);
    const lease = acquired.data;
    try {
      if (!entry.isCurrent()) return acpErr.conversationNotFound(input.conversationId);
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
    if (!retained && !this.suspendedIntents.has(conversationId)) {
      return acpErr.conversationNotFound(conversationId);
    }
    const record = this.readyRecord(conversationId);
    return record ? record.cell.editQueuedPrompt(id, input) : ok();
  }

  removeQueuedPrompt(conversationId: string, id: string): Result<void, AcpDeleteQueuedPromptError> {
    const retained = this.retained.get(conversationId);
    if (!retained && !this.suspendedIntents.has(conversationId)) {
      return acpErr.conversationNotFound(conversationId);
    }
    const record = this.readyRecord(conversationId);
    return record ? record.cell.removeQueuedPrompt(id) : ok();
  }

  reorderQueue(
    conversationId: string,
    ids: readonly string[]
  ): Result<void, AcpChangeQueuePromptOrderError> {
    const retained = this.retained.get(conversationId);
    if (!retained && !this.suspendedIntents.has(conversationId)) {
      return acpErr.conversationNotFound(conversationId);
    }
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
    entry?.suspend();
    return ok();
  }

  async kill(conversationId: string): Promise<Result<void, never>> {
    const entry = this.retained.get(conversationId);
    if (entry) {
      this.removeSuspendedIntentEntry(conversationId);
      const materializingRecord =
        entry.state === 'materializing' ? entry.currentRecord() : undefined;
      entry.kill();
      if (materializingRecord) this.interruptRecord(materializingRecord);
      await entry.waitForEviction();
      await entry.runEviction(() =>
        this.lifecycle.evict(conversationId, { cause: 'user', intent: 'remove' })
      );
      await entry.forceRemove('conversation killed');
      this.removeHandle(entry);
      return ok();
    }

    const indexed = this.suspendedIntents.delete(conversationId);
    if (indexed) this.listProjector.removeSuspendedIntent(conversationId);
    await this.lifecycle.evict(conversationId, {
      cause: 'user',
      intent: indexed ? 'keep' : 'remove',
    });
    if (indexed) {
      try {
        const removed = await this.deps.intents.remove(conversationId);
        if (!removed.success) {
          this.deps.logger.warn('SessionManager: failed to remove suspended session intent', {
            conversationId,
            error: removed.error,
          });
        }
      } catch (error) {
        this.deps.logger.warn('SessionManager: failed to remove suspended session intent', {
          conversationId,
          error: String(error),
        });
      }
    }
    return ok();
  }

  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string
  ): Result<void, AcpResolvePermissionError> {
    const retained = this.retained.get(conversationId);
    if (!retained && !this.suspendedIntents.has(conversationId)) {
      return acpErr.conversationNotFound(conversationId);
    }
    const record = this.readyRecord(conversationId);
    return record ? record.cell.resolvePermission(requestId, optionId) : ok();
  }

  async setMode(
    conversationId: string,
    modeId: string
  ): Promise<Result<void, AcpSetModeOptionError | AcpWakeFailure>> {
    const entry = this.getOrRestoreHandle(conversationId);
    if (!entry) return acpErr.conversationNotFound(conversationId);
    await entry.waitForEviction();
    if (!entry.isCurrent()) return acpErr.conversationNotFound(conversationId);
    const started = await entry.ensure();
    if (!started.success) return this.mapWakeError(started.error);
    const result = await entry.use((record) => record.cell.setMode(modeId));
    if (!result.success) {
      if (isUnambiguousStartError(result.error)) return this.mapWakeError(result.error);
      return result as Result<void, AcpSetModeOptionError>;
    }
    if (!entry.isCurrent()) return acpErr.conversationNotFound(conversationId);
    entry.updateMode(modeId);
    return ok();
  }

  async setConfigOption(
    conversationId: string,
    dimension: ConfigDimension,
    value: string
  ): Promise<Result<void, AcpSetModelOptionError | AcpWakeFailure>> {
    const entry = this.getOrRestoreHandle(conversationId);
    if (!entry) return acpErr.conversationNotFound(conversationId);
    await entry.waitForEviction();
    if (!entry.isCurrent()) return acpErr.conversationNotFound(conversationId);
    const started = await entry.ensure();
    if (!started.success) return this.mapWakeError(started.error);
    const result = await entry.use((record) => record.cell.setConfigOption(dimension, value));
    if (!result.success) {
      if (isUnambiguousStartError(result.error)) return this.mapWakeError(result.error);
      return result as Result<void, AcpSetModelOptionError>;
    }
    if (!entry.isCurrent()) return acpErr.conversationNotFound(conversationId);
    entry.updateConfig(dimension, value);
    return ok();
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
    if (
      (this.retained.has(conversationId) || this.suspendedIntents.has(conversationId)) &&
      !this.readyRecord(conversationId)
    ) {
      return { turns: [], nextCursor: null, unavailable: true };
    }
    const turns = this.getChatHistory(conversationId).committed;
    const filtered = before === undefined ? turns : turns.filter((turn) => turn.seq < before);
    const page = [...filtered].sort((a, b) => b.seq - a.seq).slice(0, limit);
    const nextCursor = page.length === limit ? page.at(-1)!.seq : null;
    return { turns: page.reverse(), nextCursor };
  }

  getSessionState(conversationId: string): SessionState {
    return (
      this.retained.get(conversationId)?.sessionState() ??
      (this.suspendedIntents.has(conversationId) ? suspendedSessionState : closedSessionState)
    );
  }

  getTerminals(conversationId: string): TerminalState[] {
    return this.terminals.listByConversation(conversationId);
  }

  getLiveModels(conversationId: string): SessionLiveModels | null {
    return this.getOrRestoreHandle(conversationId)?.projection ?? null;
  }

  syncTerminals(conversationId: string): void {
    const record = this.recordForCallbacks(conversationId);
    if (record) record.conversation.syncRecord(record);
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
      this.router.register(
        routeOwnerId(connection.key, connection.generation),
        params.sessionId,
        conversationId
      );
      record.conversation.updateProviderSessionId(params.sessionId);
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
    record.conversation.syncRecord(record);
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
    record.conversation.syncRecord(record);
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
    const records = new Set(
      [...this.retained.values()]
        .map((entry) => entry.currentRecord())
        .filter((record): record is SessionRecord => record !== undefined)
    );
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
    const entries = [...this.retained.values()];
    await Promise.all(entries.map((entry) => entry.dispose()));
    for (const entry of entries) this.removeHandle(entry);
    this.suspendedIntents.clear();
    await Promise.all([this.sessionHost.dispose(), this.sessionsHost.dispose()]);
  }

  async reconcile(): Promise<void> {
    const listed = await this.deps.intents.list();
    if (listed.success) {
      const suspended = new Map<string, SuspendedIntentEntry>();
      for (const intent of listed.data) {
        if (intent.status !== 'suspended') continue;
        if (this.retained.has(intent.conversationId)) continue;
        const indexed = this.parseIntent(intent);
        if (indexed) suspended.set(intent.conversationId, indexed);
      }
      this.suspendedIntents.clear();
      for (const [conversationId, entry] of suspended) {
        this.suspendedIntents.set(conversationId, entry);
      }
      this.listProjector.replaceSuspendedIntents(
        [...this.suspendedIntents.values()].map((entry) => entry.summary)
      );
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

  /** Snapshot-style inspection seam for lifecycle ownership and leak assertions. */
  inspect(): SessionManagerInspection {
    const retained = [...this.retained.keys()];
    const indexedSuspended = [...this.suspendedIntents.keys()];
    const running: string[] = [];
    const materializing: string[] = [];
    const pendingEvictions: string[] = [];
    for (const [conversationId, entry] of this.retained) {
      if (entry.hasActivation()) running.push(conversationId);
      if (entry.state === 'materializing') materializing.push(conversationId);
      if (entry.pendingEviction()) pendingEvictions.push(conversationId);
    }
    return { retained, indexedSuspended, running, materializing, pendingEvictions };
  }

  private evict(conversationId: string, options: EvictOptions): Promise<void> {
    const entry = this.retained.get(conversationId);
    return entry
      ? entry.runEviction(() => this.lifecycle.evict(conversationId, options))
      : this.lifecycle.evict(conversationId, options);
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

  private createHandle(
    input: AcpStartInput,
    options: { suspended: boolean; configOverrides?: ConfigOverrides; consumed?: boolean } = {
      suspended: false,
    }
  ): ConversationHandle {
    const projection = this.sessionHost.models(input.conversationId);
    const releaseProjection = this.sessionHost.models.retain(input.conversationId);
    const entry = new ConversationHandle(
      {
        projection,
        releaseProjection,
        listProjector: this.listProjector,
        terminals: this.terminals,
        saveIntent: () => this.lifecycle.saveIntent(input.conversationId),
        materialize: (scope) => this.startActivation(entry, scope),
        interruptRecord: (record) => this.interruptRecord(record),
        onActivated: (record) => {
          this.lifecycle.started(input.conversationId, {
            conversationId: input.conversationId,
            providerSessionId: record.cell.acpSessionId,
            resumeOutcome: record.resumeOutcome,
          });
        },
        activationDrainTimeoutMs:
          this.deps.lifecycle?.activationDrainTimeoutMs ?? DEFAULT_ACTIVATION_DRAIN_TIMEOUT_MS,
        onLeaseDrainTimeout: ({ leaseCount, timeoutMs }) => {
          this.deps.logger.warn('SessionManager: activation lease drain timed out', {
            conversationId: input.conversationId,
            leakedLeases: leaseCount,
            timeoutMs,
          });
        },
        onActivationObserverError: (error) => {
          this.deps.logger.warn('SessionManager: activation state observer failed', {
            conversationId: input.conversationId,
            error: String(error),
          });
        },
      },
      input,
      options.configOverrides ?? (input.model ? { model: input.model } : {}),
      options.consumed ?? false,
      options.suspended
    );
    this.retained.set(input.conversationId, entry);
    if (options.suspended) entry.initializeSuspended();
    this.removeSuspendedIntentEntry(input.conversationId);
    return entry;
  }

  private parseIntent(intent: SessionIntent): SuspendedIntentEntry | null {
    const parsed = retainedIntentSchema.safeParse(intent.payload);
    const sessionId = intent.sessionId ?? (parsed.success ? parsed.data.sessionId : null);
    if (!parsed.success || !sessionId) return null;
    const { configOverrides, ...input } = parsed.data;
    const descriptor = {
      ...input,
      conversationId: intent.conversationId,
      sessionId,
      initialQueue: undefined,
    };
    return {
      descriptor,
      configOverrides: configOverrides ?? (input.model ? { model: input.model } : {}),
      summary: {
        conversationId: intent.conversationId,
        providerId: descriptor.providerId,
        cwd: descriptor.cwd,
        updatedAt: intent.updatedAt,
      },
    };
  }

  private restoreActiveIntent(intent: SessionIntent): ConversationHandle | null {
    const existing = this.retained.get(intent.conversationId);
    if (existing) return existing;
    const indexed = this.parseIntent(intent);
    if (!indexed) return null;
    return this.createHandle(indexed.descriptor, {
      suspended: true,
      configOverrides: indexed.configOverrides,
      consumed: true,
    });
  }

  private getOrRestoreHandle(conversationId: string): ConversationHandle | null {
    const existing = this.retained.get(conversationId);
    if (existing) return existing;
    const indexed = this.suspendedIntents.get(conversationId);
    if (!indexed) return null;
    return this.createHandle(indexed.descriptor, {
      suspended: true,
      configOverrides: indexed.configOverrides,
      consumed: true,
    });
  }

  private removeSuspendedIntentEntry(conversationId: string): void {
    if (!this.suspendedIntents.delete(conversationId)) return;
    this.listProjector.removeSuspendedIntent(conversationId);
  }

  private activeIntentPayload(conversationId: string) {
    return this.retained.get(conversationId)?.intentPayload() ?? null;
  }

  private readyRecord(conversationId: string): SessionRecord | undefined {
    return this.retained.get(conversationId)?.readyRecord();
  }

  private getChatHistory(conversationId: string): AcpChatHistory {
    return this.readyRecord(conversationId)?.cell.history() ?? { committed: [], active: null };
  }

  private recordForCallbacks(conversationId: string): SessionRecord | undefined {
    return this.retained.get(conversationId)?.currentRecord();
  }

  private *runningConversationIds(): IterableIterator<string> {
    for (const [conversationId, entry] of this.retained) {
      if (entry.hasActivation()) yield conversationId;
    }
  }

  private removeHandle(entry: ConversationHandle): void {
    if (!entry.deleted && !entry.disposed) {
      throw new Error('SessionManager: conversation handle removed before kill or disposal');
    }
    if (this.retained.get(entry.conversationId) === entry) {
      this.retained.delete(entry.conversationId);
    }
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

  private async teardownRecord(record: SessionRecord): Promise<void> {
    if (record.disposed) return;
    record.disposed = true;
    record.cell.dispose();
    record.machineStateBinding.dispose();
    this.router.unregister(
      routeOwnerId(record.processKey, record.processGeneration),
      record.input.conversationId
    );
    record.conversation.clearRecord(record);
    this.terminals.disposeConversation(record.input.conversationId);
  }

  private discardReplacedRecord(record: SessionRecord): void {
    void this.teardownRecord(record);
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

function isUnambiguousStartError(error: unknown): error is ActivationStartError {
  if (typeof error !== 'object' || error === null || !('type' in error)) return false;
  return ACP_UNAMBIGUOUS_START_ERROR_TYPES.includes(
    String(error.type) as (typeof ACP_UNAMBIGUOUS_START_ERROR_TYPES)[number]
  );
}
