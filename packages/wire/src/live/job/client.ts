import { Emitter, type Unsubscribe } from '@emdash/shared';
import type { z } from 'zod';
import { LiveModelClient } from '../model';
import type { LiveJobState, LiveSnapshot, LiveUpdate } from '../protocol';

export type LiveJobClientDeps<P, R, E> = {
  refetchSnapshot: () => Promise<LiveSnapshot<LiveJobState<P, R, E>>>;
  onState?: (state: LiveJobState<P, R, E>) => void;
};

export class LiveJobFailedError<E> extends Error {
  constructor(readonly error: E) {
    super('Live job failed');
    this.name = 'LiveJobFailedError';
  }
}

export class LiveJobCancelledError extends Error {
  constructor() {
    super('Live job cancelled');
    this.name = 'LiveJobCancelledError';
  }
}

export class LiveJobClient<P, R, E> {
  readonly result: Promise<R>;

  private readonly progressEmitter = new Emitter<P>();
  private readonly model: LiveModelClient<LiveJobState<P, R, E>>;
  private lastProgressCount = 0;
  private suppressProgress = false;
  private settled = false;
  private resolveResult!: (result: R) => void;
  private rejectResult!: (err: unknown) => void;

  constructor(
    stateSchema: z.ZodType<LiveJobState<P, R, E>>,
    private readonly deps: LiveJobClientDeps<P, R, E>
  ) {
    this.result = new Promise<R>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    this.model = new LiveModelClient<LiveJobState<P, R, E>>(
      stateSchema,
      deps.refetchSnapshot,
      (state) => this.handleState(state)
    );
  }

  isReady(): boolean {
    return this.model.isReady();
  }

  getState(): LiveJobState<P, R, E> | undefined {
    return this.model.getSnapshot();
  }

  seed(snapshot: LiveSnapshot<LiveJobState<P, R, E>>): void {
    this.suppressProgress = true;
    try {
      this.model.seed(snapshot);
    } finally {
      this.suppressProgress = false;
    }
  }

  applyUpdate(update: LiveUpdate): void {
    this.model.applyUpdate(update);
  }

  async refresh(): Promise<void> {
    this.suppressProgress = true;
    try {
      await this.model.refresh();
    } finally {
      this.suppressProgress = false;
    }
  }

  onProgress(cb: (progress: P) => void): Unsubscribe {
    return this.progressEmitter.subscribe(cb);
  }

  dispose(): void {
    this.progressEmitter.clear();
  }

  private handleState(state: LiveJobState<P, R, E>): void {
    this.deps.onState?.(state);

    if (state.status === 'running') {
      this.emitNewProgress(state);
      return;
    }

    this.settle(state);
  }

  private emitNewProgress(state: Extract<LiveJobState<P, R, E>, { status: 'running' }>): void {
    if (this.suppressProgress) {
      this.lastProgressCount = state.progressCount;
      return;
    }

    if (state.progressCount <= this.lastProgressCount) return;

    const retainedStartCount = state.progressCount - state.progress.length;
    const firstNewCount = this.lastProgressCount + 1;
    const firstEmittableCount = Math.max(firstNewCount, retainedStartCount + 1);
    const startIndex = firstEmittableCount - retainedStartCount - 1;

    for (const progress of state.progress.slice(startIndex)) {
      this.progressEmitter.emit(progress);
    }
    this.lastProgressCount = state.progressCount;
  }

  private settle(state: LiveJobState<P, R, E>): void {
    if (this.settled) return;
    this.settled = true;

    if (state.status === 'succeeded') {
      this.resolveResult(state.result);
    } else if (state.status === 'failed') {
      this.rejectResult(new LiveJobFailedError(state.error));
    } else if (state.status === 'cancelled') {
      this.rejectResult(new LiveJobCancelledError());
    }
  }
}
