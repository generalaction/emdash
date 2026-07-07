import { log as ambientLog, type Logger } from '@emdash/shared/logger';
import type { WireInstrumentation, WireResyncReason } from '../../observability';
import type { LiveLogDelta, LiveLogSnapshotData, LiveSnapshot, LiveUpdate } from '../protocol';

export type LiveLogClientDeps = {
  refetchSnapshot: () => Promise<LiveSnapshot<LiveLogSnapshotData>>;
  onReset: (data: LiveLogSnapshotData) => void;
  onAppend: (chunk: string) => void;
  instrumentation?: WireInstrumentation;
  logger?: Logger;
  topic?: string;
};

export class LiveLogClient {
  private generation = -1;
  private sequence = -1;
  private value: LiveLogSnapshotData | undefined;
  private resyncing = false;

  constructor(private readonly deps: LiveLogClientDeps) {}

  isReady(): boolean {
    return this.value !== undefined;
  }

  getSnapshot(): LiveLogSnapshotData | undefined {
    return this.value;
  }

  seed(snapshot: LiveSnapshot<LiveLogSnapshotData>): void {
    this.value = snapshot.data;
    this.generation = snapshot.generation;
    this.sequence = snapshot.sequence;
    this.deps.onReset(this.value);
  }

  applyUpdate(update: LiveUpdate): void {
    if (!this.value) {
      this.reportResync('sequence-gap', { reason: 'update-before-seed' });
      void this.resync();
      return;
    }

    if (update.generation !== this.generation) {
      this.reportResync('generation', {
        local: this.generation,
        incoming: update.generation,
      });
      void this.resync();
      return;
    }

    if (update.baseSequence !== this.sequence) {
      this.reportResync('sequence-gap', {
        expected: this.sequence,
        got: update.baseSequence,
      });
      void this.resync();
      return;
    }

    if (!isLiveLogDelta(update.delta)) {
      this.reportResync('patch-failed', { reason: 'invalid-delta' });
      void this.resync();
      return;
    }

    this.sequence = update.sequence;
    this.value = {
      ...this.value,
      text: this.value.text + update.delta.chunk,
    };
    this.deps.onAppend(update.delta.chunk);
  }

  private async resync(): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    try {
      this.seed(await this.deps.refetchSnapshot());
    } finally {
      this.resyncing = false;
    }
  }

  private reportResync(reason: WireResyncReason, details: Record<string, unknown> = {}): void {
    const event = { topic: this.deps.topic, reason, details };
    this.deps.instrumentation?.resync?.(event);
    (this.deps.logger ?? ambientLog).warn('wire live log resyncing', event);
  }
}

function isLiveLogDelta(value: unknown): value is LiveLogDelta {
  return (
    typeof value === 'object' &&
    value !== null &&
    'chunk' in value &&
    typeof (value as { chunk: unknown }).chunk === 'string'
  );
}
