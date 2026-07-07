import { LiveModelServer } from '../model';
import type { LiveJobState } from '../protocol';

export const DEFAULT_LIVE_JOB_MAX_PROGRESS_ENTRIES = 100;
export const LIVE_JOB_TERMINAL_RETAIN_MS = 5 * 60 * 1000;

export type LiveJobContext<P> = {
  signal: AbortSignal;
  progress: (progress: P) => void;
};

export type LiveJobHandler<I, P, R> = (input: I, ctx: LiveJobContext<P>) => Promise<R>;

export type LiveJobServerOptions = {
  generation?: number;
  maxProgressEntries?: number;
};

type LiveJobRun<P, R, E> = {
  abort: AbortController;
  model: LiveModelServer<LiveJobState<P, R, E>>;
  evictionTimer: ReturnType<typeof setTimeout> | undefined;
};

/**
 * Transport-agnostic cancellable job source.
 *
 * A LiveJob survives transport disconnects because each job is represented by a
 * LiveModel-backed state resource. It is intentionally not durable across host
 * process restarts.
 */
export class LiveJobServer<I, P, R, E> {
  private readonly runs = new Map<string, LiveJobRun<P, R, E>>();
  private readonly generation: number | undefined;
  private readonly maxProgressEntries: number;

  constructor(
    private readonly handler: LiveJobHandler<I, P, R>,
    private readonly toError: (err: unknown) => E,
    options: LiveJobServerOptions = {}
  ) {
    this.generation = options.generation;
    this.maxProgressEntries = Math.max(
      0,
      options.maxProgressEntries ?? DEFAULT_LIVE_JOB_MAX_PROGRESS_ENTRIES
    );
  }

  start(input: I): { jobId: string } {
    const jobId = crypto.randomUUID();
    const abort = new AbortController();
    const model = new LiveModelServer<LiveJobState<P, R, E>>(
      {
        status: 'running',
        startedAt: Date.now(),
        progress: [],
        progressCount: 0,
      },
      this.generation ?? Date.now()
    );
    const run: LiveJobRun<P, R, E> = {
      abort,
      model,
      evictionTimer: undefined,
    };

    this.runs.set(jobId, run);
    void this.execute(jobId, input, run);

    return { jobId };
  }

  cancel(jobId: string): void {
    const run = this.runs.get(jobId);
    if (!run || run.abort.signal.aborted || !this.isRunning(run)) return;
    run.abort.abort();
  }

  job(jobId: string): LiveModelServer<LiveJobState<P, R, E>> | undefined {
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
      return { status: 'succeeded', result };
    });
  }

  private markFailed(run: LiveJobRun<P, R, E>, err: unknown): void {
    run.model.produce((draft) => {
      if (draft.status !== 'running') return;
      return { status: 'failed', error: this.toError(err) };
    });
  }

  private markCancelled(run: LiveJobRun<P, R, E>): void {
    run.model.produce((draft) => {
      if (draft.status !== 'running') return;
      return { status: 'cancelled' };
    });
  }

  private scheduleEviction(jobId: string, run: LiveJobRun<P, R, E>): void {
    if (this.runs.get(jobId) !== run) return;
    if (run.evictionTimer) clearTimeout(run.evictionTimer);
    run.evictionTimer = setTimeout(() => {
      if (this.runs.get(jobId) === run) this.runs.delete(jobId);
    }, LIVE_JOB_TERMINAL_RETAIN_MS);
  }

  private isRunning(run: LiveJobRun<P, R, E>): boolean {
    return run.model.snapshot().data.status === 'running';
  }
}
