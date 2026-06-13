import { log } from '@main/lib/logger';
import { err } from '@shared/lib/result';
import type { GitRepositoryService } from './service';

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;

type GitRepositoryFetchTarget = Pick<GitRepositoryService, 'fetch' | 'getRemotes'>;
type AppFetchResult = Awaited<ReturnType<GitRepositoryFetchTarget['fetch']>>;

export class GitRepositoryFetchService {
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _inflight: Promise<AppFetchResult> | undefined;
  private readonly intervalMs = DEFAULT_INTERVAL_MS;

  constructor(
    private readonly gitRepository: GitRepositoryFetchTarget,
    private readonly getRemote: () => Promise<string | undefined>
  ) {}

  /** Start the background fetch loop: immediate fetch, then every `intervalMs`. */
  start(): void {
    void this._canBackgroundFetchWithoutPrompt().then((canFetch) => {
      if (canFetch) void this._doFetch();
    });
    this._scheduleNext();
  }

  /**
   * Trigger an immediate fetch and reset the interval timer so the next
   * background tick is `intervalMs` from now. Concurrent callers share the
   * same in-flight promise (deduplicated).
   */
  async fetch(): Promise<AppFetchResult> {
    this._resetTimer();
    return this._doFetch();
  }

  stop(): void {
    clearInterval(this._timer);
    this._timer = undefined;
  }

  private _doFetch(): Promise<AppFetchResult> {
    if (this._inflight) return this._inflight;
    this._inflight = this.getRemote()
      .then(async (remote) => {
        return this.gitRepository.fetch(remote);
      })
      .catch((e): AppFetchResult => {
        log.warn('GitRepositoryFetchService: fetch threw unexpectedly', { error: String(e) });
        return err({ type: 'error', message: String(e) });
      })
      .finally(() => {
        this._inflight = undefined;
      });
    return this._inflight;
  }

  private _resetTimer(): void {
    clearInterval(this._timer);
    this._scheduleNext();
  }

  private _scheduleNext(): void {
    this._timer = setInterval(() => {
      void this._canBackgroundFetchWithoutPrompt().then((canFetch) => {
        if (canFetch) void this._doFetch();
      });
    }, this.intervalMs);
  }

  private async _canBackgroundFetchWithoutPrompt(): Promise<boolean> {
    try {
      await this.gitRepository.getRemotes();
    } catch {
      return false;
    }

    return true;
  }
}
