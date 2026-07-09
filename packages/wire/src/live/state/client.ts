import type { Logger } from '@emdash/shared/logger';
import type z from 'zod';
import type { WireInstrumentation } from '../../observability';
import { LiveFollower } from '../follower';
import type { LiveCursor, LiveSnapshot, LiveUpdate } from '../protocol';
import { createPlainStore, createStateMaterializer, type StateStore } from '../replica/store';
import { LiveStateWaiters } from './waiters';

export type LiveChangeMeta = { kind: 'seed' } | { kind: 'update'; mutationIds: string[] };

export type LiveStateClientOptions<T = unknown> = {
  instrumentation?: WireInstrumentation;
  logger?: Logger;
  topic?: string;
  store?: StateStore<T>;
};

export class LiveStateClient<T> {
  private readonly follower: LiveFollower<T>;
  private readonly waiters = new LiveStateWaiters(() => this.cursor);
  private readonly store: StateStore<T>;
  private readonly onChange: (value: T, meta: LiveChangeMeta) => void;

  constructor(
    schema: z.ZodType<T>,
    refetchSnapshot: () => Promise<LiveSnapshot<T>>,
    onChange: (value: T, meta: LiveChangeMeta) => void,
    options: LiveStateClientOptions<T> = {}
  ) {
    const { store, ...followerOptions } = options;
    this.store = store ?? createPlainStore<T>();
    this.onChange = onChange;
    this.follower = new LiveFollower(refetchSnapshot, createStateMaterializer(this.store, schema), {
      ...followerOptions,
      label: 'live model',
      onSeeded: () => this.handleSeeded(),
      onApplied: (update) => this.handleApplied(update),
    });
  }

  get cursor(): LiveCursor | undefined {
    return this.follower.cursor;
  }

  isReady(): boolean {
    return this.follower.isReady();
  }

  getSnapshot(): T | undefined {
    if (!this.follower.isReady()) return undefined;
    return this.store.current();
  }

  seed(snapshot: LiveSnapshot<T>): void {
    this.follower.seed(snapshot);
  }

  applyUpdate(update: LiveUpdate): void {
    this.follower.applyUpdate(update);
  }

  refresh(): Promise<void> {
    return this.follower.refresh();
  }

  /** Resolves when local state provably includes the given cursor. */
  waitForCursor(target: LiveCursor, timeoutMs = 15_000): Promise<void> {
    return this.waiters.waitForCursor(target, timeoutMs);
  }

  /**
   * Resolves when an update tagged with this mutation ID is applied.
   * Any seed/resync also resolves because a fresh snapshot is authoritative.
   */
  waitForMutation(mutationId: string, timeoutMs = 15_000): Promise<void> {
    return this.waiters.waitForMutation(mutationId, timeoutMs);
  }

  private handleSeeded(): void {
    this.onChange(this.store.current(), { kind: 'seed' });
    this.waiters.flushCursorWaiters();
    this.waiters.flushAllMutationWaiters();
  }

  private handleApplied(update: LiveUpdate): void {
    this.onChange(this.store.current(), { kind: 'update', mutationIds: update.mutationIds ?? [] });
    this.waiters.flushCursorWaiters();
    this.waiters.flushMutationWaiters(update.mutationIds ?? []);
  }
}
