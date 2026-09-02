import type { Scope } from '@emdash/shared/concurrency';
import {
  retrySchedules,
  systemClock,
  waitWithSignal,
  type RetrySchedule,
} from '@emdash/shared/scheduling';
import type { IWatchService, WatchEvent, WatchHandle } from '#services/fs-watch/api';

/** Freshness floor for a searchable root whose watcher is unavailable. */
const DEGRADED_POLL_MS = 60_000;

const defaultRetrySchedule = (): RetrySchedule =>
  retrySchedules.jitter(retrySchedules.exponential({ initialMs: 5_000, maxMs: 300_000 }));

type RunLimited = <T>(signal: AbortSignal, operation: () => Promise<T>) => Promise<T>;

export type WatchSupervisorHealth = 'attaching' | 'live' | 'degraded';

type WatchAttachOutcome = Readonly<{ kind: 'attached' } | { kind: 'failed'; error: unknown }>;

type WatchSupervisorOptions = Readonly<{
  rootPath: string;
  watcher: IWatchService;
  ignoreGlobs: readonly string[];
  debounceMs: number;
  scope: Scope;
  runWatchStart: RunLimited;
  retrySchedule?: RetrySchedule;
  degradedPollMs?: number;
  onEvents(events: WatchEvent[]): void;
  onRefresh(): void;
  onAttached(): Promise<void>;
  isPermanentFailure(error: unknown): boolean;
  onError?: (context: string, error: unknown) => void;
}>;

/**
 * Owns one root's watcher lifecycle: attachment, terminal-handle replacement,
 * bounded retry with backoff, and degraded polling. A failed `ready()` is
 * terminal for its handle — recovery always acquires a fresh subscription.
 */
export class WatchSupervisor {
  private state: WatchSupervisorHealth = 'attaching';
  private currentHandle: WatchHandle | undefined;
  private pollingStarted = false;

  constructor(private readonly options: WatchSupervisorOptions) {
    options.scope.add(() => this.currentHandle?.release());
    this.startAttachmentLoop();
  }

  get health(): WatchSupervisorHealth {
    return this.state;
  }

  private startAttachmentLoop(): void {
    const run = this.options.scope.run('watch-attach', (signal) => this.attachmentLoop(signal));
    void run.value().catch((error: unknown) => {
      if (!this.options.scope.signal.aborted) {
        this.report('file-search watcher attachment loop failed', error);
      }
    });
  }

  private async attachmentLoop(signal: AbortSignal): Promise<void> {
    const schedule = this.options.retrySchedule ?? defaultRetrySchedule();
    for (let attempt = 0; ; attempt += 1) {
      const outcome = await this.attemptAttach(signal);
      if (outcome.kind === 'attached') {
        await this.options.onAttached();
        this.state = 'live';
        return;
      }

      this.state = 'degraded';
      this.report('file-search watcher could not attach to the root', outcome.error);
      if (this.options.isPermanentFailure(outcome.error)) return;

      this.startDegradedPolling();
      const delayMs = schedule.delayFor(attempt);
      if (delayMs === undefined) return;
      await systemClock.sleep(delayMs, { signal });
    }
  }

  private async attemptAttach(signal: AbortSignal): Promise<WatchAttachOutcome> {
    try {
      return await this.options.runWatchStart(signal, async () => {
        const handle = this.createHandle();
        this.currentHandle = handle;
        const attached = await waitWithSignal(handle.ready(), signal, 'Watch supervisor cancelled');
        if (attached.success) return { kind: 'attached' as const };
        await this.releaseFailedHandle(handle);
        return { kind: 'failed' as const, error: attached.error };
      });
    } catch (error) {
      if (this.options.scope.signal.aborted || signal.aborted) throw error;
      return { kind: 'failed', error };
    }
  }

  private createHandle(): WatchHandle {
    return this.options.watcher.watch(
      this.options.rootPath,
      (events) => this.options.onEvents(events),
      {
        debounceMs: this.options.debounceMs,
        ignore: [...this.options.ignoreGlobs],
        onResync: () => this.options.onRefresh(),
      }
    );
  }

  private async releaseFailedHandle(handle: WatchHandle): Promise<void> {
    if (this.currentHandle === handle) this.currentHandle = undefined;
    try {
      await handle.release();
    } catch (error) {
      this.report('file-search watcher release failed', error);
    }
  }

  private startDegradedPolling(): void {
    if (this.pollingStarted || this.options.scope.state !== 'open') return;
    this.pollingStarted = true;
    const pollMs = this.options.degradedPollMs ?? DEGRADED_POLL_MS;
    const run = this.options.scope.run('watch-degraded-poll', async (signal) => {
      while (this.state === 'degraded') {
        await systemClock.sleep(pollMs, { signal });
        if (this.state !== 'degraded') return;
        this.options.onRefresh();
      }
    });
    void run.value().catch((error: unknown) => {
      if (!this.options.scope.signal.aborted) {
        this.report('file-search degraded polling failed', error);
      }
    });
  }

  private report(context: string, error: unknown): void {
    this.options.onError?.(context, error);
  }
}
