import {
  gitContract,
  type FetchError,
  type RepositorySelector,
} from '@emdash/core/runtimes/git/api';
import { err, type Result } from '@emdash/shared';
import { gitErrorMessage, runGitJob } from '@main/core/git/runtime-process/client';
import type { GitRuntimeClient } from '@main/core/git/runtime-process/host';
import { log } from '@main/lib/logger';

const DEFAULT_INTERVAL_MS = 2 * 60 * 1000;

type GitRepositoryFetchResult = Result<void, FetchError>;

export class GitRepositoryFetchService {
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _inflight: Promise<GitRepositoryFetchResult> | undefined;
  private readonly intervalMs = DEFAULT_INTERVAL_MS;

  constructor(
    private readonly git: GitRuntimeClient,
    private readonly repository: RepositorySelector,
    private readonly getRemote: () => Promise<string | undefined>
  ) {}

  /** Start the background fetch loop: immediate fetch, then every `intervalMs`. */
  start(): void {
    void this._canBackgroundFetchWithoutPrompt().then((canFetch) => {
      if (canFetch) void this._doFetch();
    });
    this._scheduleNext();
  }

  stop(): void {
    clearInterval(this._timer);
    this._timer = undefined;
  }

  private _doFetch(): Promise<GitRepositoryFetchResult> {
    if (this._inflight) return this._inflight;
    this._inflight = this.getRemote()
      .then(async (remote) => {
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

  private _scheduleNext(): void {
    this._timer = setInterval(() => {
      void this._canBackgroundFetchWithoutPrompt().then((canFetch) => {
        if (canFetch) void this._doFetch();
      });
    }, this.intervalMs);
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
