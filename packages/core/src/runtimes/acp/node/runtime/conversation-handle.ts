import type { Lease, Result, Serializable } from '@emdash/shared';
import { ok } from '@emdash/shared';
import { createLifecycleCell, type LifecycleCell, type Scope } from '@emdash/shared/concurrency';
import { acpErr } from '#runtimes/acp/api';
import type { AgentTerminalManager } from '#runtimes/acp/node/agent-ports/terminal-manager';
import type { SessionConfigCatalog } from '#runtimes/acp/node/session/cell';
import {
  closedSessionState,
  emptyRetainedPresentation,
  retainedConfig,
  suspendedSessionState,
  type ActivationSnapshot,
  type RetainedPresentation,
  type SessionLiveModels,
} from '#runtimes/acp/node/state/live-models';
import type {
  ActivationStartError,
  ConfigDimension,
  ConfigOverrides,
  SessionRecord,
} from './conversation-types';
import type { SessionsListProjector } from './sessions-list-projector';
import type { AcpStartInput } from './types';

export type ConversationHandleState =
  | 'closed'
  | 'suspended'
  | 'materializing'
  | 'active'
  | 'stopping'
  | 'killed';

export interface ConversationHandleDeps {
  projection: SessionLiveModels;
  releaseProjection(): void;
  listProjector: SessionsListProjector;
  terminals: Pick<AgentTerminalManager, 'listByConversation'>;
  saveIntent(): void;
  materialize(scope: Scope): Promise<Result<SessionRecord, ActivationStartError>>;
  interruptRecord(record: SessionRecord): void;
  onActivated(record: SessionRecord): void;
  activationDrainTimeoutMs: number;
  onLeaseDrainTimeout(event: { leaseCount: number; timeoutMs: number }): void;
  onActivationObserverError(error: unknown): void;
  now(): number;
}

export class ConversationHandle {
  readonly conversationId: string;
  private stateValue: ConversationHandleState = 'closed';
  private epochValue = 0;
  private recordValue: SessionRecord | null = null;
  private materializationAbort: AbortController | null = null;
  private projectionReleased = false;
  private disposedValue = false;
  private evictionPromiseValue: Promise<void> | null = null;
  private retainedValue: RetainedPresentation;
  private desiredRevisionValue = 0;
  private readonly activation: LifecycleCell<
    void,
    SessionRecord,
    ActivationStartError,
    void,
    never
  >;

  constructor(
    readonly deps: ConversationHandleDeps,
    public descriptor: AcpStartInput,
    public configOverrides: ConfigOverrides,
    public initialQueueConsumed: boolean,
    public everMaterialized: boolean,
    retained?: RetainedPresentation
  ) {
    this.conversationId = descriptor.conversationId;
    this.retainedValue =
      retained ?? emptyRetainedPresentation(configuredFromDescriptor(descriptor));
    this.activation = createLifecycleCell({
      label: `acp-conversation:${this.conversationId}`,
      start: (_input, scope) => this.deps.materialize(scope),
      interrupt: (record) => this.deps.interruptRecord(record),
      stop: async () => ok(),
      drainTimeoutMs: deps.activationDrainTimeoutMs,
      onLeaseDrainTimeout: (event) => deps.onLeaseDrainTimeout(event),
      onStateChanged: (change) => this.onActivationStateChanged(change.current),
      onObserverError: ({ error }) => deps.onActivationObserverError(error),
    });
  }

  get state(): ConversationHandleState {
    return this.stateValue;
  }

  get epoch(): number {
    return this.epochValue;
  }

  get deleted(): boolean {
    return this.stateValue === 'killed';
  }

  get disposed(): boolean {
    return this.disposedValue;
  }

  get desiredRevision(): number {
    return this.desiredRevisionValue;
  }

  get projection(): SessionLiveModels {
    return this.deps.projection;
  }

  initializeSuspended(): void {
    if (this.stateValue !== 'closed') return;
    this.suspend();
  }

  beginMaterialization(): { epoch: number; signal: AbortSignal } | null {
    if (!this.isCurrent()) return null;
    this.epochValue += 1;
    this.materializationAbort?.abort(new Error('ACP materialization superseded'));
    this.materializationAbort = new AbortController();
    this.stateValue = 'materializing';
    this.recordValue = null;
    this.deps.projection.source.set({
      kind: 'active',
      snapshot: startingSnapshot(this.retainedValue),
    });
    this.deps.listProjector.upsert(this.materializationInput(), null, {
      lifecycle: 'starting',
      isGenerating: false,
      pendingPermissionCount: 0,
      backgroundAgentCount: 0,
      queuedPromptCount: 0,
    });
    return { epoch: this.epochValue, signal: this.materializationAbort.signal };
  }

  isEpochCurrent(epoch: number): boolean {
    return this.isCurrent() && this.epochValue === epoch;
  }

  isCurrent(): boolean {
    return !this.disposedValue && this.stateValue !== 'killed';
  }

  ensure(): Promise<Result<SessionRecord, ActivationStartError>> {
    if (!this.isCurrent()) {
      return Promise.resolve(acpErr.conversationNotFound(this.conversationId));
    }
    return this.activation.start();
  }

  acquire(): Promise<Result<Lease<SessionRecord>, ActivationStartError>> {
    if (!this.isCurrent()) {
      return Promise.resolve(acpErr.conversationNotFound(this.conversationId));
    }
    return this.activation.acquire();
  }

  use<T, UseError>(
    operation: (record: SessionRecord) => Result<T, UseError> | Promise<Result<T, UseError>>
  ): Promise<Result<T, ActivationStartError | UseError>> {
    if (!this.isCurrent()) {
      return Promise.resolve(acpErr.conversationNotFound(this.conversationId));
    }
    return this.activation.use<T, ActivationStartError | UseError>(undefined, (record) => {
      if (!this.isCurrentRecord(record)) {
        return acpErr.conversationNotFound(this.conversationId);
      }
      return operation(record);
    });
  }

  stopActivation(): Promise<Result<void, never>> {
    return this.activation.stop();
  }

  forceRemove(reason?: unknown): Promise<void> {
    return this.activation.forceRemove(reason);
  }

  hasActivation(): boolean {
    return this.activation.has();
  }

  runEviction(operation: () => Promise<void>): Promise<void> {
    if (this.evictionPromiseValue) return this.evictionPromiseValue;
    const pending = operation().finally(() => {
      if (this.evictionPromiseValue === pending) this.evictionPromiseValue = null;
    });
    this.evictionPromiseValue = pending;
    return pending;
  }

  waitForEviction(): Promise<void> {
    return this.evictionPromiseValue ?? Promise.resolve();
  }

  pendingEviction(): Promise<void> | null {
    return this.evictionPromiseValue;
  }

  attachProvisional(record: SessionRecord): void {
    if (!this.isEpochCurrent(record.epoch)) return;
    this.recordValue = record;
    this.syncRecord(record);
  }

  discardProvisional(record: SessionRecord): void {
    if (this.recordValue !== record) return;
    this.recordValue = null;
  }

  activate(record: SessionRecord): void {
    if (!this.isEpochCurrent(record.epoch) || this.recordValue !== record) return;
    this.materializationAbort = null;
    this.stateValue = 'active';
    this.syncRecord(record);
  }

  beginStopping(): void {
    if (this.stateValue === 'killed') return;
    this.stateValue = 'stopping';
    this.publishSuspended();
  }

  suspend(): void {
    if (this.stateValue === 'killed') return;
    this.materializationAbort = null;
    this.stateValue = 'suspended';
    this.publishSuspended();
  }

  close(): void {
    if (this.stateValue === 'killed') return;
    this.materializationAbort = null;
    this.stateValue = 'closed';
    this.deps.projection.source.set({ kind: 'closed' });
  }

  kill(reason: unknown = new Error('ACP conversation killed')): void {
    if (this.stateValue === 'killed') return;
    this.epochValue += 1;
    this.stateValue = 'killed';
    this.materializationAbort?.abort(reason);
    this.materializationAbort = null;
    this.recordValue = null;
    this.deps.projection.source.set({ kind: 'closed' });
    this.deps.listProjector.remove(this.conversationId);
    this.releaseProjection();
  }

  abortMaterialization(reason: unknown): void {
    this.materializationAbort?.abort(reason);
  }

  clearRecord(record: SessionRecord): void {
    if (this.recordValue !== record) return;
    this.recordValue = null;
  }

  currentRecord(): SessionRecord | undefined {
    if (
      this.stateValue === 'killed' ||
      this.stateValue === 'closed' ||
      this.stateValue === 'suspended'
    ) {
      return undefined;
    }
    return this.recordValue ?? undefined;
  }

  readyRecord(): SessionRecord | undefined {
    return this.stateValue === 'active' ? (this.recordValue ?? undefined) : undefined;
  }

  isCurrentRecord(record: SessionRecord): boolean {
    return (
      this.isEpochCurrent(record.epoch) &&
      this.recordValue === record &&
      (this.stateValue === 'materializing' ||
        this.stateValue === 'active' ||
        this.stateValue === 'stopping')
    );
  }

  syncRecord(record: SessionRecord): void {
    if (!this.canPublishRecord(record)) return;
    if (this.stateValue === 'active') this.captureRetained(record);
    const snapshot = this.buildSnapshot(record);
    this.deps.projection.source.set({
      kind: 'active',
      snapshot,
    });
    this.deps.listProjector.upsert(record.input, record.cell, record.cell.sessionState);
  }

  sessionState() {
    const record = this.currentRecord();
    if (record && this.canPublishRecord(record)) return record.cell.sessionState;
    return this.stateValue === 'killed' || this.stateValue === 'closed'
      ? closedSessionState
      : suspendedSessionState;
  }

  materializationInput(): AcpStartInput {
    return {
      ...this.descriptor,
      initialQueue: this.initialQueueConsumed ? undefined : this.descriptor.initialQueue,
    };
  }

  markMaterialized(record: SessionRecord, initialQueueConsumed: boolean): void {
    if (!this.isCurrentRecord(record)) return;
    this.initialQueueConsumed = initialQueueConsumed;
    this.everMaterialized = true;
    this.updateDescriptor({ sessionId: record.cell.acpSessionId });
    this.syncRecord(record);
  }

  updateMode(modeId: string): void {
    this.updateConfigured({ modeId });
    this.updateDescriptor({ modeId });
  }

  updateProviderSessionId(sessionId: string): void {
    this.updateDescriptor({ sessionId });
  }

  updateConfig(dimension: ConfigDimension, value: string): void {
    this.configOverrides = { ...this.configOverrides, [dimension]: value };
    this.updateConfigured({ [dimension]: value });
    this.updateDescriptor(
      dimension === 'model'
        ? { model: value }
        : dimension === 'effort'
          ? { effort: value }
          : { collaborationMode: value },
      true
    );
  }

  clearMode(): void {
    this.updateConfigured({ modeId: null });
    this.updateDescriptor({ modeId: null });
  }

  clearConfig(dimension: ConfigDimension): void {
    const { [dimension]: _removed, ...remaining } = this.configOverrides;
    this.configOverrides = remaining;
    this.updateConfigured({ [dimension]: null });
    this.updateDescriptor(
      dimension === 'model'
        ? { model: null }
        : dimension === 'effort'
          ? { effort: null }
          : { collaborationMode: null },
      true
    );
  }

  refreshDescriptor(descriptor: AcpStartInput): void {
    if (!this.isCurrent()) return;
    this.descriptor = {
      ...descriptor,
      // The runtime can observe a replacement session id before the host report converges. A
      // stale host value must not discard that newer runtime fact on the next activation.
      sessionId:
        this.everMaterialized && this.descriptor.sessionId
          ? this.descriptor.sessionId
          : descriptor.sessionId,
    };
    this.configOverrides = {
      ...(descriptor.model ? { model: descriptor.model } : {}),
      ...(descriptor.effort ? { effort: descriptor.effort } : {}),
      ...(descriptor.collaborationMode ? { collaborationMode: descriptor.collaborationMode } : {}),
    };
    this.updateConfigured(configuredFromDescriptor(descriptor));
  }

  saveIntent(): void {
    if (this.isCurrent()) this.deps.saveIntent();
  }

  intentPayload(): { payload: Serializable; sessionId?: string | null } | null {
    if (!this.isCurrent()) return null;
    return {
      payload: {
        version: '1',
        conversationId: this.conversationId,
        providerId: this.descriptor.providerId,
        cwd: this.descriptor.cwd,
        sessionId: this.descriptor.sessionId,
        configured: this.retainedValue.configured,
        presentation: this.retainedValue,
      } as unknown as Serializable,
      sessionId: this.descriptor.sessionId,
    };
  }

  async dispose(): Promise<void> {
    if (this.disposedValue) return;
    this.disposedValue = true;
    if (this.stateValue !== 'killed') {
      this.epochValue += 1;
      this.materializationAbort?.abort(new Error('ACP conversation directory disposed'));
      this.materializationAbort = null;
    }
    await this.activation.dispose();
    if (this.stateValue !== 'killed') {
      this.stateValue = 'closed';
      this.recordValue = null;
      this.deps.projection.source.set({ kind: 'closed' });
    }
    this.releaseProjection();
  }

  private onActivationStateChanged(
    state: ReturnType<ConversationHandle['activation']['state']>
  ): void {
    switch (state.kind) {
      case 'ready':
        this.activate(state.value);
        if (this.stateValue === 'active') this.deps.onActivated(state.value);
        return;
      case 'stopping':
        this.beginStopping();
        return;
      case 'idle':
      case 'start-failed':
        if (this.everMaterialized) this.suspend();
        else this.close();
        return;
      case 'disposed':
        this.close();
        return;
      case 'starting':
      case 'stop-failed':
        return;
    }
  }

  private updateDescriptor(patch: Partial<AcpStartInput>, persistEvenUnchanged = false): void {
    if (!this.isCurrent()) return;
    const changed = Object.entries(patch).some(
      ([key, value]) => this.descriptor[key as keyof AcpStartInput] !== value
    );
    if (!changed && !persistEvenUnchanged) return;
    this.descriptor = { ...this.descriptor, ...patch };
    if (this.everMaterialized) this.deps.saveIntent();
  }

  private canPublishRecord(record: SessionRecord): boolean {
    return (
      this.isEpochCurrent(record.epoch) &&
      this.recordValue === record &&
      (this.stateValue === 'materializing' || this.stateValue === 'active')
    );
  }

  private publishSuspended(): void {
    this.deps.projection.source.set({ kind: 'suspended', retained: this.retainedValue });
    this.deps.listProjector.suspend(this.descriptor);
  }

  private buildSnapshot(record: SessionRecord): ActivationSnapshot {
    const state = record.cell.sessionState;
    const lastKnownCapabilities = mergeCapabilities(
      this.retainedValue.lastKnownCapabilities,
      record.cell.config,
      record.cell.configCatalog,
      this.stateValue === 'materializing'
    );
    return {
      state: this.stateValue === 'materializing' ? { ...state, canSubmit: true } : state,
      config: retainedConfig({ ...this.retainedValue, lastKnownCapabilities }),
      usage: record.cell.usage ?? this.retainedValue.lastKnownUsage,
      plan: record.cell.transcript.plan,
      agents: record.cell.transcript.agents,
      activeTurn: record.cell.transcript.activeTurn,
      terminals: this.deps.terminals.listByConversation(this.conversationId),
      mcpServers:
        this.stateValue === 'materializing' && record.mcpServers.length === 0
          ? this.retainedValue.lastKnownMcpServers
          : record.mcpServers,
    };
  }

  private releaseProjection(): void {
    if (this.projectionReleased) return;
    this.projectionReleased = true;
    this.deps.releaseProjection();
  }

  private captureRetained(record: SessionRecord): void {
    const nextContent = {
      configured: this.retainedValue.configured,
      lastKnownCapabilities: mergeCapabilities(
        this.retainedValue.lastKnownCapabilities,
        record.cell.config,
        record.cell.configCatalog
      ),
      lastKnownMcpServers: record.mcpServers,
      lastKnownUsage: record.cell.usage ?? this.retainedValue.lastKnownUsage,
    };
    if (sameRetainedContent(this.retainedValue, nextContent)) return;
    this.retainedValue = { ...nextContent, observedAt: this.deps.now() };
    if (this.everMaterialized) this.deps.saveIntent();
  }

  private updateConfigured(patch: Partial<RetainedPresentation['configured']>): void {
    this.desiredRevisionValue += 1;
    this.retainedValue = {
      ...this.retainedValue,
      configured: { ...this.retainedValue.configured, ...patch },
    };
    if (this.stateValue === 'suspended') this.publishSuspended();
    if (this.stateValue === 'materializing' && this.recordValue === null) {
      this.deps.projection.source.set({
        kind: 'active',
        snapshot: startingSnapshot(this.retainedValue),
      });
    }
    const record = this.recordValue;
    if (record && this.canPublishRecord(record)) this.syncRecord(record);
  }
}

function startingSnapshot(retained: RetainedPresentation): ActivationSnapshot {
  return {
    state: { ...closedSessionState, lifecycle: 'starting', canSubmit: true },
    config: retainedConfig(retained),
    usage: retained.lastKnownUsage,
    plan: null,
    agents: [],
    activeTurn: null,
    terminals: [],
    mcpServers: retained.lastKnownMcpServers,
  };
}

function configuredFromDescriptor(descriptor: AcpStartInput): RetainedPresentation['configured'] {
  return {
    model: descriptor.model ?? null,
    modeId: descriptor.modeId ?? null,
    effort: descriptor.effort ?? null,
    collaborationMode: descriptor.collaborationMode ?? null,
  };
}

function sameRetainedContent(
  retained: RetainedPresentation,
  next: Omit<RetainedPresentation, 'observedAt'>
): boolean {
  const { observedAt: _observedAt, ...current } = retained;
  return JSON.stringify(current) === JSON.stringify(next);
}

function mergeCapabilities(
  retained: RetainedPresentation['lastKnownCapabilities'],
  current: RetainedPresentation['lastKnownCapabilities'],
  catalog: SessionConfigCatalog,
  preservePendingCommands = false
): RetainedPresentation['lastKnownCapabilities'] {
  const capabilities =
    catalog.kind === 'ready'
      ? catalog.config
      : {
          modelOptions: current.modelOptions ?? retained.modelOptions,
          efforts: current.efforts ?? retained.efforts,
          modeOptions: current.modeOptions ?? retained.modeOptions,
          collaborationModeOptions:
            current.collaborationModeOptions ?? retained.collaborationModeOptions ?? null,
        };
  return {
    ...capabilities,
    availableCommands:
      preservePendingCommands && current.availableCommands.length === 0
        ? retained.availableCommands
        : current.availableCommands,
  };
}
