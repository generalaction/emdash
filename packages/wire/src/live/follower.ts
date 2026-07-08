import { log as ambientLog, type Logger } from '@emdash/shared/logger';
import type { WireInstrumentation, WireResyncReason } from '../observability';
import type { LiveCursor, LiveSnapshot, LiveUpdate } from './protocol';

export type LiveFollowerApplyResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: WireResyncReason; details?: Record<string, unknown> };

type LiveFollowerOptions = {
  instrumentation?: WireInstrumentation;
  logger?: Logger;
  topic?: string;
  label: string;
};

export abstract class LiveFollower<T> {
  protected value: T | undefined;

  private generation = -1;
  private sequence = -1;
  private resyncing = false;

  constructor(
    private readonly refetchSnapshot: () => Promise<LiveSnapshot<T>>,
    private readonly options: LiveFollowerOptions
  ) {}

  get cursor(): LiveCursor | undefined {
    if (this.generation < 0) return undefined;
    return {
      generation: this.generation,
      sequence: this.sequence,
    };
  }

  isReady(): boolean {
    return this.value !== undefined;
  }

  getSnapshot(): T | undefined {
    return this.value;
  }

  seed(snapshot: LiveSnapshot<T>): void {
    this.value = snapshot.data;
    this.generation = snapshot.generation;
    this.sequence = snapshot.sequence;
    this.onSeeded(snapshot.data);
  }

  applyUpdate(update: LiveUpdate): void {
    if (this.value === undefined) {
      this.triggerResync('sequence-gap', { reason: 'update-before-seed' });
      return;
    }

    if (update.generation !== this.generation) {
      this.triggerResync('generation', {
        local: this.generation,
        incoming: update.generation,
      });
      return;
    }

    if (update.baseSequence !== this.sequence) {
      this.triggerResync('sequence-gap', {
        expected: this.sequence,
        got: update.baseSequence,
      });
      return;
    }

    const applied = this.applyDelta(update);
    if (!applied.ok) {
      this.triggerResync(applied.reason, applied.details ?? {});
      return;
    }

    this.value = applied.value;
    this.sequence = update.sequence;
    this.onApplied(applied.value, update);
  }

  async refresh(): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    try {
      this.seed(await this.refetchSnapshot());
    } finally {
      this.resyncing = false;
    }
  }

  protected triggerResync(reason: WireResyncReason, details: Record<string, unknown> = {}): void {
    const event = { topic: this.options.topic, reason, details };
    this.options.instrumentation?.resync?.(event);
    (this.options.logger ?? ambientLog).warn(`wire ${this.options.label} resyncing`, event);
    void this.refresh();
  }

  protected abstract onSeeded(data: T): void;
  protected abstract applyDelta(update: LiveUpdate): LiveFollowerApplyResult<T>;
  protected abstract onApplied(value: T, update: LiveUpdate): void;
}
