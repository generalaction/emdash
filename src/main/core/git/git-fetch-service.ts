import type { FetchError } from '@shared/git';
import { err, type Result } from '@shared/result';
import { log } from '@main/lib/logger';
import type { GitService } from './impl/git-service';
import { isGitHubSshRemoteUrl, isSshRemoteUrl } from './remote-helper';

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;

export class GitFetchService {
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _inflight: Promise<Result<void, FetchError>> | undefined;
  private readonly intervalMs = DEFAULT_INTERVAL_MS;

  constructor(
    private readonly git: GitService,
    private readonly hasGitHubToken: () => Promise<boolean>
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
  async fetch(): Promise<Result<void, FetchError>> {
    this._resetTimer();
    return this._doFetch();
  }

  stop(): void {
    clearInterval(this._timer);
    this._timer = undefined;
  }

  private _doFetch(): Promise<Result<void, FetchError>> {
    if (this._inflight) return this._inflight;
    this._inflight = this.git
      .fetch()
      .catch((e): Result<void, FetchError> => {
        log.warn('GitFetchService: fetch threw unexpectedly', { error: String(e) });
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
    let remotes: { url: string }[] = [];
    try {
      remotes = await this.git.getRemotes();
    } catch {
      return false;
    }

    const sshRemotes = remotes.filter((remote) => isSshRemoteUrl(remote.url));
    if (sshRemotes.length === 0) return true;
    if (!sshRemotes.every((remote) => isGitHubSshRemoteUrl(remote.url))) return false;

    return await this.hasGitHubToken();
  }
}
