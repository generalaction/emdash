import type { LiveCursor } from '../protocol';

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

export class LiveModelWaiters {
  private cursorWaiters: CursorWaiter[] = [];
  private mutationWaiters: MutationWaiter[] = [];

  constructor(private readonly cursor: () => LiveCursor | undefined) {}

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

  flushCursorWaiters(): void {
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

  flushMutationWaiters(mutationIds: string[]): void {
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

  flushAllMutationWaiters(): void {
    const ready = this.mutationWaiters;
    if (ready.length === 0) return;
    this.mutationWaiters = [];
    for (const waiter of ready) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  rejectAll(error: Error): void {
    const cursorWaiters = this.cursorWaiters;
    const mutationWaiters = this.mutationWaiters;
    this.cursorWaiters = [];
    this.mutationWaiters = [];
    for (const waiter of cursorWaiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    for (const waiter of mutationWaiters) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private cursorSatisfies(target: LiveCursor): boolean {
    const cursor = this.cursor();
    if (!cursor) return false;
    if (cursor.generation > target.generation) return true;
    return cursor.generation === target.generation && cursor.sequence >= target.sequence;
  }
}

function formatCursor(cursor: LiveCursor): string {
  return `${cursor.generation}:${cursor.sequence}`;
}
