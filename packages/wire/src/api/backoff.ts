import { retrySchedules, type JitterOptions, type RetrySchedule } from '@emdash/shared/scheduling';

/**
 * The single backoff vocabulary for retry timing in wire.
 *
 * Every wire site that waits between retry attempts — the reconnecting
 * transport's reconnect schedule, worker-slot supervision, the follower's
 * `resyncRetry` policy, and per-call opt-in retries — expresses its timing as a
 * `BackoffSchedule`. Shared vocabulary, not shared state: each site owns an
 * independently tunable schedule, but the schedules stay comparable.
 *
 * `delayFor(0)` is the delay before the first retry; `undefined` means retries
 * are exhausted (see `@emdash/shared/scheduling`).
 */
export type BackoffSchedule = RetrySchedule;

export type BackoffScheduleOptions = {
  /**
   * Delay before each retry, walked in order. With `repeatLast` the final
   * delay repeats forever; without it the schedule exhausts past the end.
   */
  delaysMs: readonly number[];
  /** Repeat the final delay indefinitely instead of exhausting the schedule. */
  repeatLast?: boolean;
  /** Cap on the number of retries; omit for no cap beyond the sequence itself. */
  maxRetries?: number;
  /** Randomize each delay; inject a deterministic `random` in tests. */
  jitter?: JitterOptions;
};

/**
 * Builds a {@link BackoffSchedule} from a delay sequence, building on the
 * shared scheduling utilities. Callers with needs beyond a sequence (e.g.
 * exponential growth) can compose `retrySchedules` from
 * `@emdash/shared/scheduling` directly — the result is the same vocabulary.
 */
export function backoffSchedule(options: BackoffScheduleOptions): BackoffSchedule {
  let schedule = retrySchedules.sequence(options.delaysMs, { repeatLast: options.repeatLast });
  if (options.maxRetries !== undefined) {
    schedule = retrySchedules.limit(options.maxRetries, schedule);
  }
  if (options.jitter) schedule = retrySchedules.jitter(schedule, options.jitter);
  return schedule;
}
