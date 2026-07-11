import { Emitter, type SerializedError, type Unsubscribe } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { z } from 'zod';
import type { WireInstrumentation } from '../../observability';
import { systemClock, type Clock } from '../../scheduling';
import type { LiveCursor, LiveJobState, LiveSnapshot, LiveUpdate } from '../protocol';
import { LiveStateClient } from '../state';

export type LiveJobClientDeps<P, R, E> = {
  refetchSnapshot: () => Promise<LiveSnapshot<LiveJobState<P, R, E>>>;
  onState?: (state: LiveJobState<P, R, E>) => void;
  instrumentation?: WireInstrumentation;
  logger?: Logger;
  topic?: string;
  clock?: Clock;
};

export class LiveJobFailedError<E> extends Error {
  constructor(
    readonly error: E | undefined,
    options: { cause?: SerializedError } = {}
  ) {
    super('Live job failed');
    this.name = 'LiveJobFailedError';
    this.cause = options.cause;
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
  private readonly model: LiveStateClient<LiveJobState<P, R, E>>;
  private lastProgressCount = 0;
  private suppressProgress = false;
  private settled = false;
  private readonly clock: Clock;
  private resolveResult!: (result: R) => void;
  private rejectResult!: (err: unknown) => void;

  constructor(
    stateSchema: z.ZodType<LiveJobState<P, R, E>>,
    private readonly deps: LiveJobClientDeps<P, R, E>
  ) {
    this.clock = deps.clock ?? systemClock;
    this.result = new Promise<R>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    this.model = new LiveStateClient<LiveJobState<P, R, E>>(
      stateSchema,
      deps.refetchSnapshot,
      (state) => this.handleState(state),
      {
        instrumentation: deps.instrumentation,
        logger: deps.logger,
        topic: deps.topic,
      }
    );
  }

  isReady(): boolean {
    return this.model.isReady();
  }

  get cursor(): LiveCursor | undefined {
    return this.model.cursor;
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

  waitForTerminal(timeoutMs = 15_000): Promise<void> {
    if (this.settled) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? this.clock.schedule(
              timeoutMs,
              () => {
                cleanup();
                reject(new Error('Timed out waiting for live job to finish'));
              },
              { unref: true }
            )
          : undefined;
      const cleanup = this.onStateChange((state) => {
        if (state.status === 'running') return;
        timer?.dispose();
        cleanup();
        resolve();
      });
    });
  }

  waitForProgressCount(count: number, timeoutMs = 15_000): Promise<void> {
    if (this.progressCountSatisfies(count)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? this.clock.schedule(
              timeoutMs,
              () => {
                cleanup();
                reject(new Error(`Timed out waiting for live job progress count ${count}`));
              },
              { unref: true }
            )
          : undefined;
      const cleanup = this.onStateChange(() => {
        if (!this.progressCountSatisfies(count)) return;
        timer?.dispose();
        cleanup();
        resolve();
      });
    });
  }

  dispose(): void {
    this.progressEmitter.clear();
    this.stateEmitter.clear();
  }

  private handleState(state: LiveJobState<P, R, E>): void {
    this.deps.onState?.(state);
    this.stateEmitter.emit(state);

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
      this.rejectResult(new LiveJobFailedError(state.error, { cause: state.cause }));
    } else if (state.status === 'cancelled') {
      this.rejectResult(new LiveJobCancelledError());
    }
  }

  private readonly stateEmitter = new Emitter<LiveJobState<P, R, E>>();

  private onStateChange(cb: (state: LiveJobState<P, R, E>) => void): Unsubscribe {
    return this.stateEmitter.subscribe(cb);
  }

  private progressCountSatisfies(count: number): boolean {
    const state = this.getState();
    return state?.status === 'running' && state.progressCount >= count;
  }
}
