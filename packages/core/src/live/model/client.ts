import type z from 'zod';
import { applyPatches, type Patch } from './immer-setup';
import type { LiveSnapshot, LiveUpdate } from '../protocol';

export class LiveModelClient<T> {
  private generation = -1;
  private sequence = -1;
  private value: T | undefined;
  private resyncing = false;

  constructor(
    private readonly schema: z.ZodType<T>,
    private readonly refetchSnapshot: () => Promise<LiveSnapshot<T>>,
    private readonly onChange: (value: T) => void
  ) {}

  /** True once the first seed() has landed. */
  isReady(): boolean {
    return this.value !== undefined;
  }

  /** The current value, or undefined before the first seed. */
  getSnapshot(): T | undefined {
    return this.value;
  }

  seed(snapshot: LiveSnapshot<T>): void {
    this.value = snapshot.data;
    this.generation = snapshot.generation;
    this.sequence = snapshot.sequence;
    this.onChange(this.value);
  }

  applyUpdate(update: LiveUpdate): void {
    if (!this.value) {
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
      next = applyPatches(this.value, update.delta as Patch[]) as T;
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
  }

  /**
   * Validates the patched result against the schema.
   * Skipped entirely in production — the generation + baseSequence gap guards
   * are the primary correctness mechanism; schema validation is a dev-only
   * safety net that catches shape regressions early.
   */
  private validate(next: unknown): next is T {
    if (process.env['NODE_ENV'] === 'production') return true;
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
}
