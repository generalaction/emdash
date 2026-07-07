import type z from 'zod';
import type { LiveCursor, LiveSnapshot, LiveUpdate } from '../protocol';
import { applyPatches, type Patch } from './immer-setup';

type CursorWaiter = {
  target: LiveCursor;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

type MutationWaiter = {
  mutationId: string;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

export class LiveModelClient<T> {
  private generation = -1;
  private sequence = -1;
  private value: T | undefined;
  private resyncing = false;
  private cursorWaiters: CursorWaiter[] = [];
  private mutationWaiters: MutationWaiter[] = [];

  constructor(
    private readonly schema: z.ZodType<T>,
    private readonly refetchSnapshot: () => Promise<LiveSnapshot<T>>,
    private readonly onChange: (value: T) => void
  ) {}

  get cursor(): LiveCursor | undefined {
    if (this.generation < 0) return undefined;
    return {
      generation: this.generation,
      sequence: this.sequence,
    };
  }

  /** True once the first seed() has landed. */
  isReady(): boolean {
    return this.value !== undefined;
  }

  /** The current value, or undefined before the first seed. */
  getSnapshot(): T | undefined {
    return this.value;
  }

  seed(snapshot: LiveSnapshot<T>): void {
    const next = snapshot.data;
    this.value = next;
    this.generation = snapshot.generation;
    this.sequence = snapshot.sequence;
    this.onChange(next);
    this.flushCursorWaiters();
    this.flushAllMutationWaiters();
  }

  applyUpdate(update: LiveUpdate): void {
    if (this.value === undefined) {
      console.log('[LiveModelClient] applyUpdate called before seed, resyncing');
      void this.resync();
      return;
    }

    if (update.generation !== this.generation) {
      console.log('[LiveModelClient] generation mismatch — resyncing', {
        local: this.generation,
        incoming: update.generation,
      });
      void this.resync();
      return;
    }

    if (update.baseSequence !== this.sequence) {
      console.log('[LiveModelClient] sequence gap — resyncing', {
        expected: this.sequence,
        got: update.baseSequence,
      });
      void this.resync();
      return;
    }

    let next: T;
    try {
      // applyPatches returns a new structurally-shared reference — untouched
      // subtrees keep identity, which allows downstream memoized selectors to
      // avoid recomputing on unchanged branches.
      next = applyPatches(this.value as object, update.delta as Patch[]) as T;
    } catch (err) {
      console.log('[LiveModelClient] applyPatches threw — resyncing', err);
      void this.resync();
      return;
    }

    if (!this.validate(next)) {
      void this.resync();
      return;
    }

    this.value = next;
    this.sequence = update.sequence;
    this.onChange(this.value);
    this.flushCursorWaiters();
    this.flushMutationWaiters(update.mutationIds ?? []);
  }

  /** Resolves when local state provably includes the given cursor. */
  waitForCursor(target: LiveCursor, timeoutMs = 15_000): Promise<void> {
    if (this.cursorSatisfies(target)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter: CursorWaiter = {
        target,
        resolve,
        reject,
        timer:
          timeoutMs > 0
            ? setTimeout(() => {
                this.cursorWaiters = this.cursorWaiters.filter((candidate) => candidate !== waiter);
                reject(new Error(`Timed out waiting for live cursor ${formatCursor(target)}`));
              }, timeoutMs)
            : undefined,
      };
      this.cursorWaiters.push(waiter);
    });
  }

  /**
   * Resolves when an update tagged with this mutation ID is applied.
   * Any seed/resync also resolves because a fresh snapshot is authoritative.
   */
  waitForMutation(mutationId: string, timeoutMs = 15_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter: MutationWaiter = {
        mutationId,
        resolve,
        reject,
        timer:
          timeoutMs > 0
            ? setTimeout(() => {
                this.mutationWaiters = this.mutationWaiters.filter(
                  (candidate) => candidate !== waiter
                );
                reject(new Error(`Timed out waiting for live mutation ${mutationId}`));
              }, timeoutMs)
            : undefined,
      };
      this.mutationWaiters.push(waiter);
    });
  }

  /**
   * Validates the patched result against the schema.
   * Skipped entirely in production — the generation + baseSequence gap guards
   * are the primary correctness mechanism; schema validation is a dev-only
   * safety net that catches shape regressions early.
   */
  private validate(next: unknown): next is T {
    if (readNodeEnv() === 'production') return true;
    const r = this.schema.safeParse(next);
    if (!r.success) {
      console.warn('[LiveModelClient] patched result failed validation — resyncing', r.error);
      return false;
    }
    return true;
  }

  private async resync(): Promise<void> {
    if (this.resyncing) return;
    this.resyncing = true;
    try {
      this.seed(await this.refetchSnapshot());
    } finally {
      this.resyncing = false;
    }
  }

  private cursorSatisfies(target: LiveCursor): boolean {
    if (this.generation < 0) return false;
    if (this.generation > target.generation) return true;
    return this.generation === target.generation && this.sequence >= target.sequence;
  }

  private flushCursorWaiters(): void {
    const ready = this.cursorWaiters.filter((waiter) => this.cursorSatisfies(waiter.target));
    if (ready.length === 0) return;
    this.cursorWaiters = this.cursorWaiters.filter(
      (waiter) => !this.cursorSatisfies(waiter.target)
    );
    for (const waiter of ready) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private flushMutationWaiters(mutationIds: string[]): void {
    if (mutationIds.length === 0) return;
    const ids = new Set(mutationIds);
    const ready = this.mutationWaiters.filter((waiter) => ids.has(waiter.mutationId));
    if (ready.length === 0) return;
    this.mutationWaiters = this.mutationWaiters.filter((waiter) => !ids.has(waiter.mutationId));
    for (const waiter of ready) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private flushAllMutationWaiters(): void {
    const ready = this.mutationWaiters;
    if (ready.length === 0) return;
    this.mutationWaiters = [];
    for (const waiter of ready) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }
}

function formatCursor(cursor: LiveCursor): string {
  return `${cursor.generation}:${cursor.sequence}`;
}

function readNodeEnv(): string | undefined {
  return typeof process !== 'undefined' ? process.env['NODE_ENV'] : undefined;
}
