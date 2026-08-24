import type { Serializable } from '@emdash/shared';
import { initialSessionConfigState } from '#runtimes/acp/api';
import {
  closedSessionState,
  suspendedSessionState,
  type ActivationSnapshot,
  type SessionLiveModels,
} from '#runtimes/acp/node/state/live-models';
import type { ConfigDimension, ConfigOverrides, SessionRecord } from './conversation-types';
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
  isOwned(): boolean;
  saveIntent(): void;
  buildSnapshot(record: SessionRecord): ActivationSnapshot;
  onMaterializingRecord(record: SessionRecord | null): void;
}

export class ConversationHandle {
  readonly conversationId: string;
  private stateValue: ConversationHandleState = 'closed';
  private epochValue = 0;
  private recordValue: SessionRecord | null = null;
  private materializationAbort: AbortController | null = null;
  private projectionReleased = false;

  constructor(
    readonly deps: ConversationHandleDeps,
    public descriptor: AcpStartInput,
    public configOverrides: ConfigOverrides,
    public initialQueueConsumed: boolean,
    public everMaterialized: boolean
  ) {
    this.conversationId = descriptor.conversationId;
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

  get projection(): SessionLiveModels {
    return this.deps.projection;
  }

  initializeSuspended(): void {
    if (this.stateValue !== 'closed') return;
    this.suspend();
  }

  beginMaterialization(): { epoch: number; signal: AbortSignal } | null {
    if (!this.isOwned() || this.stateValue === 'killed') return null;
    this.epochValue += 1;
    this.materializationAbort?.abort(new Error('ACP materialization superseded'));
    this.materializationAbort = new AbortController();
    this.stateValue = 'materializing';
    this.recordValue = null;
    this.deps.projection.source.set({ kind: 'active', snapshot: startingSnapshot() });
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
    return this.isOwned() && this.stateValue !== 'killed' && this.epochValue === epoch;
  }

  isCurrent(): boolean {
    return this.isOwned() && this.stateValue !== 'killed';
  }

  attachProvisional(record: SessionRecord): void {
    if (!this.isEpochCurrent(record.epoch)) return;
    this.recordValue = record;
    this.deps.onMaterializingRecord(record);
    this.syncRecord(record);
  }

  discardProvisional(record: SessionRecord): void {
    if (this.recordValue !== record) return;
    this.recordValue = null;
    this.deps.onMaterializingRecord(null);
  }

  activate(record: SessionRecord): void {
    if (!this.isEpochCurrent(record.epoch) || this.recordValue !== record) return;
    this.materializationAbort = null;
    this.stateValue = 'active';
    this.deps.onMaterializingRecord(null);
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

  kill(reason = new Error('ACP conversation killed')): void {
    if (this.stateValue === 'killed') return;
    this.epochValue += 1;
    this.stateValue = 'killed';
    this.materializationAbort?.abort(reason);
    this.materializationAbort = null;
    this.recordValue = null;
    this.deps.onMaterializingRecord(null);
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
    this.deps.onMaterializingRecord(null);
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
    this.deps.projection.source.set({
      kind: 'active',
      snapshot: this.deps.buildSnapshot(record),
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
    this.updateDescriptor({ modeId });
  }

  updateProviderSessionId(sessionId: string): void {
    this.updateDescriptor({ sessionId });
  }

  updateConfig(dimension: ConfigDimension, value: string): void {
    this.configOverrides = { ...this.configOverrides, [dimension]: value };
    this.updateDescriptor(dimension === 'model' ? { model: value } : {}, true);
  }

  saveIntent(): void {
    if (this.isOwned() && this.stateValue !== 'killed') this.deps.saveIntent();
  }

  intentPayload(): { payload: Serializable; sessionId?: string | null } | null {
    if (!this.isOwned() || this.stateValue === 'killed') return null;
    const { initialQueue: _initialQueue, ...persisted } = this.descriptor;
    return {
      payload: {
        ...persisted,
        ...(Object.keys(this.configOverrides).length > 0
          ? { configOverrides: this.configOverrides }
          : {}),
      } as unknown as Serializable,
      sessionId: this.descriptor.sessionId,
    };
  }

  dispose(): void {
    if (this.stateValue !== 'killed') {
      this.epochValue += 1;
      this.materializationAbort?.abort(new Error('ACP conversation directory disposed'));
      this.materializationAbort = null;
      this.stateValue = 'closed';
      this.recordValue = null;
      this.deps.onMaterializingRecord(null);
      this.deps.projection.source.set({ kind: 'closed' });
    }
    this.releaseProjection();
  }

  private updateDescriptor(patch: Partial<AcpStartInput>, persistEvenUnchanged = false): void {
    if (!this.isOwned() || this.stateValue === 'killed') return;
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
    this.deps.projection.source.set({ kind: 'suspended' });
    this.deps.listProjector.suspend(this.descriptor);
  }

  private isOwned(): boolean {
    return this.deps.isOwned();
  }

  private releaseProjection(): void {
    if (this.projectionReleased) return;
    this.projectionReleased = true;
    this.deps.releaseProjection();
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
