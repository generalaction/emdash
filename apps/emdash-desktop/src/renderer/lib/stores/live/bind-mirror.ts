import type { LiveValue } from '@emdash/core/lib';
import type { Result, Unsubscribe } from '@emdash/shared';
import { makeObservable, observable, runInAction } from 'mobx';
import type { ModelMirror } from './model-mirror';

export type MirrorBindingStatus =
  /** Not started yet. */
  | 'idle'
  /** Started, but the mirror has not been hydrated since (re)starting. */
  | 'syncing'
  /** Subscription active and the mirror holds a value. */
  | 'live'
  /** Repeated snapshot failures; retries continue in the background. */
  | 'error';

export type MirrorBinding = {
  readonly status: MirrorBindingStatus;
  start(): void;
  resync(): Promise<void>;
  dispose(): void;
};

const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const ERROR_AFTER_FAILURES = 3;

export type BindMirrorOptions<T, E = unknown> = {
  mirror: ModelMirror<T>;
  subscribe: (push: (value: LiveValue<T>) => void) => Unsubscribe;
  snapshot: () => Promise<Result<LiveValue<T>, E>>;
  onError?: (error: E) => void;
  onUnexpectedError?: (error: unknown) => void;
};

class MirrorBindingImpl<T, E> implements MirrorBinding {
  status: MirrorBindingStatus = 'idle';

  private started = false;
  private unsubscribe: Unsubscribe | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private inFlight: Promise<void> | null = null;
  private runId = 0;

  constructor(private readonly opts: BindMirrorOptions<T, E>) {
    makeObservable(this, { status: observable });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.runId += 1;
    const runId = this.runId;
    this.setStatus('syncing');
    this.unsubscribe = this.opts.subscribe((value) => {
      if (!this.started || runId !== this.runId) return;
      this.opts.mirror.applyUpdate(value);
      if (this.opts.mirror.current) this.markLive();
    });
    void this.resync();
  }

  resync(): Promise<void> {
    if (!this.started) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.clearRetry();
    this.inFlight = this.loadSnapshot(this.runId);
    return this.inFlight;
  }

  dispose(): void {
    this.runId += 1;
    this.clearRetry();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.inFlight = null;
    this.started = false;
    this.failures = 0;
    this.setStatus('idle');
  }

  private async loadSnapshot(runId: number): Promise<void> {
    try {
      const result = await this.opts.snapshot();
      if (runId !== this.runId || !this.started) return;
      if (!result.success) {
        this.recordSnapshotFailure(result.error);
        return;
      }
      this.opts.mirror.setSnapshot(result.data);
      this.markLive();
    } catch (error) {
      if (runId !== this.runId || !this.started) return;
      this.recordUnexpectedSnapshotFailure(error);
    } finally {
      if (runId === this.runId) this.inFlight = null;
    }
  }

  private recordSnapshotFailure(error: E): void {
    this.failures += 1;
    if (this.failures >= ERROR_AFTER_FAILURES) this.setStatus('error');
    this.opts.onError?.(error);
    this.scheduleRetry();
  }

  private recordUnexpectedSnapshotFailure(error: unknown): void {
    this.failures += 1;
    if (this.failures >= ERROR_AFTER_FAILURES) this.setStatus('error');
    this.opts.onUnexpectedError?.(error);
    this.scheduleRetry();
  }

  private markLive(): void {
    this.failures = 0;
    this.clearRetry();
    this.setStatus('live');
  }

  private scheduleRetry(): void {
    if (!this.started || this.retryTimer) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.failures - 1, RETRY_DELAYS_MS.length - 1)];
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.resync();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private setStatus(status: MirrorBindingStatus): void {
    if (this.status === status) return;
    runInAction(() => {
      this.status = status;
    });
  }
}

export function bindMirror<T, E = unknown>(opts: BindMirrorOptions<T, E>): MirrorBinding {
  return new MirrorBindingImpl(opts);
}
