import {
  gitContract,
  type FetchError,
  type RepositorySelector,
} from '@emdash/core/runtimes/git/api';
import { err, ok, type Result } from '@emdash/shared';
import { gitErrorMessage, runGitJob } from '@main/core/git/runtime-client';
import type { GitRuntimeClient } from '@main/gateway/desktop-workers';
import { log } from '@main/lib/logger';

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;
/** The pause after a fetch is at least this many times its duration. */
const SLOW_FETCH_BACKOFF_FACTOR = 10;
const MAX_SLOW_FETCH_DELAY_MS = 30 * 60 * 1000;

type GitRepositoryFetchResult = Result<void, FetchError>;

/**
 * The pause before the next background fetch, measured from the end of the last one.
 * A slow fetch (large repository, many refs) stretches the pause so background
 * fetching stays a small share of the time instead of running back to back.
 */
export function nextBackgroundFetchDelay(
  lastFetchDurationMs: number,
  intervalMs = DEFAULT_INTERVAL_MS
): number {
  const backoff = Math.min(
    lastFetchDurationMs * SLOW_FETCH_BACKOFF_FACTOR,
    MAX_SLOW_FETCH_DELAY_MS
  );
  return Math.max(intervalMs, backoff);
}

export class GitRepositoryFetchService {
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _inflight: Promise<GitRepositoryFetchResult> | undefined;
  /** Bumped by start/stop so a loop that was stopped never reschedules itself. */
  private _generation = 0;
  private _running = false;

  constructor(
    private readonly git: GitRuntimeClient,
    private readonly repository: RepositorySelector,
    /** Resolver-backed effective base remote; `null` means no remotes exist. */
    private readonly getRemote: () => Promise<string | null>
  ) {}

  /** Start the background fetch loop: immediate fetch, then one after each pause. */
  start(): void {
    if (this._running) return;
    this._running = true;
    void this._tick(++this._generation);
  }

  stop(): void {
    this._running = false;
    this._generation++;
    clearTimeout(this._timer);
    this._timer = undefined;
  }

  private async _tick(generation: number): Promise<void> {
    const startedAt = Date.now();
    if (await this._canBackgroundFetchWithoutPrompt()) await this._doFetch();
    if (generation !== this._generation) return;
    const delay = nextBackgroundFetchDelay(Date.now() - startedAt);
    this._timer = setTimeout(() => void this._tick(generation), delay);
  }

  private _doFetch(): Promise<GitRepositoryFetchResult> {
    if (this._inflight) return this._inflight;
    this._inflight = this.getRemote()
      .then(async (remote) => {
        // No remotes resolved — nothing to fetch (never a literal fallback).
        if (remote === null) return ok(undefined);
        return runGitJob(gitContract.repository.fetch, this.git.repository.fetch, {
          ...this.repository,
          remote,
        });
      })
      .catch((e): GitRepositoryFetchResult => {
        const message = gitErrorMessage(e);
        log.warn('GitRepositoryFetchService: fetch threw unexpectedly', { error: message });
        return err({ type: 'git_error', message });
      })
      .finally(() => {
        this._inflight = undefined;
      });
    return this._inflight;
  }

  private async _canBackgroundFetchWithoutPrompt(): Promise<boolean> {
    try {
      await this.git.repository.model.state(this.repository, 'remotes').snapshot();
    } catch {
      return false;
    }

    return true;
  }
}
