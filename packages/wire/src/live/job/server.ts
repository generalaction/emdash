import { LiveModel } from '../model';
import type { LiveJobState, LiveSnapshot, LiveSource } from '../protocol';

export const DEFAULT_LIVE_JOB_MAX_PROGRESS_ENTRIES = 100;
export const LIVE_JOB_TERMINAL_RETAIN_MS = 5 * 60 * 1000;

export type LiveJobContext<P> = {
  signal: AbortSignal;
  progress: (progress: P) => void;
};

export type LiveJobHandler<I, P, R> = (input: I, ctx: LiveJobContext<P>) => Promise<R>;

export type LiveJobListEntry = {
  jobId: string;
  status: LiveJobState<unknown, unknown, unknown>['status'];
  startedAt: number;
  finishedAt?: number;
};

export type LiveJobOptions = {
  generation?: number;
  maxProgressEntries?: number;
  terminalRetainMs?: number;
  idFactory?: () => string;
  clock?: () => number;
  onRunStarted?: (entry: LiveJobListEntry) => void;
  onRunChanged?: (entry: LiveJobListEntry) => void;
  onRunEvicted?: (jobId: string) => void;
};

type LiveJobRun<P, R, E> = {
  abort: AbortController;
  model: LiveModel<LiveJobState<P, R, E>>;
  evictionTimer: ReturnType<typeof setTimeout> | undefined;
};

/**
 * Transport-agnostic cancellable job source.
 *
 * Each run is represented by a LiveModel-backed state resource, so jobs inherit
 * the snapshot/update protocol used by LiveModel while keeping execution,
 * cancellation, and terminal retention scoped to this primitive.
 *
 * A LiveJob survives transport disconnects, but it is process-local and not
 * durable across host process restarts. Terminal runs are retained only until
 * the configured eviction delay expires.
 */
export class LiveJob<I, P, R, E> {
  private readonly runs = new Map<string, LiveJobRun<P, R, E>>();
  private readonly generation: number | undefined;
  private readonly maxProgressEntries: number;
  private readonly terminalRetainMs: number;
  private readonly idFactory: () => string;
  private readonly clock: () => number;

  constructor(
    private readonly handler: LiveJobHandler<I, P, R>,
    private readonly toError: (err: unknown) => E,
    private readonly options: LiveJobOptions = {}
  ) {
    this.generation = options.generation;
    this.maxProgressEntries = Math.max(
      0,
      options.maxProgressEntries ?? DEFAULT_LIVE_JOB_MAX_PROGRESS_ENTRIES
    );
    this.terminalRetainMs = Math.max(0, options.terminalRetainMs ?? LIVE_JOB_TERMINAL_RETAIN_MS);
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? (() => Date.now());
  }

  start(input: I): { jobId: string } {
    const jobId = this.idFactory();
    const abort = new AbortController();
    const now = this.clock();
    const model = new LiveModel<LiveJobState<P, R, E>>(
      {
        status: 'running',
        startedAt: now,
        progress: [],
        progressCount: 0,
      },
      this.generation ?? now
    );
    const run: LiveJobRun<P, R, E> = {
      abort,
      model,
      evictionTimer: undefined,
    };

    this.runs.set(jobId, run);
    this.options.onRunStarted?.(this.toListEntry(jobId, run));
    void this.execute(jobId, input, run);

    return { jobId };
  }

  cancel(jobId: string): void {
    const run = this.runs.get(jobId);
    if (!run || run.abort.signal.aborted || !this.isRunning(run)) return;
    run.abort.abort();
  }

  source(jobId: string): LiveSource | undefined {
    return this.runs.get(jobId)?.model;
  }

  snapshot(jobId: string): LiveSnapshot<LiveJobState<P, R, E>> | undefined {
    return this.runs.get(jobId)?.model.snapshot();
  }

  getState(jobId: string): LiveJobState<P, R, E> | undefined {
    return this.snapshot(jobId)?.data;
  }

  private job(jobId: string): LiveModel<LiveJobState<P, R, E>> | undefined {
    return this.runs.get(jobId)?.model;
  }

  dispose(): void {
    for (const run of this.runs.values()) {
      if (run.evictionTimer) clearTimeout(run.evictionTimer);
      if (this.isRunning(run) && !run.abort.signal.aborted) run.abort.abort();
    }
    this.runs.clear();
  }

  private async execute(jobId: string, input: I, run: LiveJobRun<P, R, E>): Promise<void> {
    try {
      const result = await this.handler(input, {
        signal: run.abort.signal,
        progress: (progress) => this.reportProgress(run, progress),
      });
      if (run.abort.signal.aborted) {
        this.markCancelled(run);
      } else {
        this.markSucceeded(run, result);
      }
    } catch (err) {
      if (run.abort.signal.aborted) {
        this.markCancelled(run);
      } else {
        this.markFailed(run, err);
      }
    } finally {
      this.scheduleEviction(jobId, run);
    }
  }

  private reportProgress(run: LiveJobRun<P, R, E>, progress: P): void {
    if (run.abort.signal.aborted) return;
    run.model.produce((draft) => {
      if (draft.status !== 'running') return;
      draft.progress.push(progress);
      if (draft.progress.length > this.maxProgressEntries) {
        draft.progress.splice(0, draft.progress.length - this.maxProgressEntries);
      }
      draft.progressCount += 1;
    });
  }

  private markSucceeded(run: LiveJobRun<P, R, E>, result: R): void {
    run.model.produce((draft) => {
      if (draft.status !== 'running') return;
      return {
        status: 'succeeded',
        startedAt: draft.startedAt,
        finishedAt: this.clock(),
        progress: [...draft.progress],
        result,
      };
    });
  }

  private markFailed(run: LiveJobRun<P, R, E>, err: unknown): void {
    run.model.produce((draft) => {
      if (draft.status !== 'running') return;
      return {
        status: 'failed',
        startedAt: draft.startedAt,
        finishedAt: this.clock(),
        progress: [...draft.progress],
        error: this.toError(err),
      };
    });
  }

  private markCancelled(run: LiveJobRun<P, R, E>): void {
    run.model.produce((draft) => {
      if (draft.status !== 'running') return;
      return {
        status: 'cancelled',
        startedAt: draft.startedAt,
        finishedAt: this.clock(),
        progress: [...draft.progress],
      };
    });
  }

  private scheduleEviction(jobId: string, run: LiveJobRun<P, R, E>): void {
    if (this.runs.get(jobId) !== run) return;
    this.options.onRunChanged?.(this.toListEntry(jobId, run));
    if (run.evictionTimer) clearTimeout(run.evictionTimer);
    run.evictionTimer = setTimeout(() => {
      if (this.runs.get(jobId) !== run) return;
      this.runs.delete(jobId);
      this.options.onRunEvicted?.(jobId);
    }, this.terminalRetainMs);
  }

  private isRunning(run: LiveJobRun<P, R, E>): boolean {
    return run.model.snapshot().data.status === 'running';
  }

  private toListEntry(jobId: string, run: LiveJobRun<P, R, E>): LiveJobListEntry {
    const state = run.model.snapshot().data;
    return {
      jobId,
      status: state.status,
      startedAt: state.startedAt,
      finishedAt: state.status === 'running' ? undefined : state.finishedAt,
    };
  }
}
