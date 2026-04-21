import type { PullRequest } from '@shared/pull-requests';
import { log } from '@main/lib/logger';
import { prSyncEngine } from './pr-service';

/**
 * Manages per-repository AbortControllers so syncs can be cancelled
 * and deduplicates concurrent calls for the same repository URL.
 */
export class PrSyncCoordinator {
  private readonly _fullSyncControllers = new Map<string, AbortController>();
  private readonly _incrementalSyncControllers = new Map<string, AbortController>();
  private readonly _inflight = new Map<string, Promise<void>>();

  // ── Full sync ──────────────────────────────────────────────────────────────

  /** Cancel any in-progress full sync for this URL and start a new one. */
  runFullSync(repositoryUrl: string): void {
    this._cancelFull(repositoryUrl);

    const ctrl = new AbortController();
    this._fullSyncControllers.set(repositoryUrl, ctrl);

    const key = `full:${repositoryUrl}`;
    const promise = prSyncEngine
      .runFullSync(repositoryUrl, ctrl.signal)
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') {
          log.error('PrSyncCoordinator: full sync failed', { repositoryUrl, error: String(e) });
        }
      })
      .finally(() => {
        this._fullSyncControllers.delete(repositoryUrl);
        this._inflight.delete(key);
      });

    this._inflight.set(key, promise);
  }

  // ── Incremental sync ───────────────────────────────────────────────────────

  /** Run an incremental sync; no-ops if one is already in flight for this URL. */
  runIncrementalSync(repositoryUrl: string): void {
    const key = `incremental:${repositoryUrl}`;
    if (this._inflight.has(key)) return;

    const ctrl = new AbortController();
    this._incrementalSyncControllers.set(repositoryUrl, ctrl);

    const promise = prSyncEngine
      .runIncrementalSync(repositoryUrl, ctrl.signal)
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') {
          log.error('PrSyncCoordinator: incremental sync failed', {
            repositoryUrl,
            error: String(e),
          });
        }
      })
      .finally(() => {
        this._incrementalSyncControllers.delete(repositoryUrl);
        this._inflight.delete(key);
      });

    this._inflight.set(key, promise);
  }

  // ── Single PR sync ─────────────────────────────────────────────────────────

  async syncSingle(repositoryUrl: string, prNumber: number): Promise<PullRequest | null> {
    const key = `single:${repositoryUrl}:${prNumber}`;
    if (this._inflight.has(key)) {
      await this._inflight.get(key);
      return null;
    }

    const ctrl = new AbortController();
    let result: PullRequest | null = null;

    const promise = prSyncEngine
      .syncSingle(repositoryUrl, prNumber, ctrl.signal)
      .then((pr) => {
        result = pr;
      })
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') {
          log.error('PrSyncCoordinator: single sync failed', {
            repositoryUrl,
            prNumber,
            error: String(e),
          });
        }
      })
      .finally(() => {
        this._inflight.delete(key);
      });

    this._inflight.set(key, promise);
    await promise;
    return result;
  }

  // ── Check run sync ─────────────────────────────────────────────────────────

  async syncChecks(pullRequestUrl: string, headRefOid: string): Promise<boolean> {
    const ctrl = new AbortController();
    try {
      return await prSyncEngine.syncChecks(pullRequestUrl, headRefOid, ctrl.signal);
    } catch (e: unknown) {
      if ((e as { name?: string }).name !== 'AbortError') {
        log.error('PrSyncCoordinator: syncChecks failed', { pullRequestUrl, error: String(e) });
      }
      return false;
    }
  }

  // ── Cancellation ──────────────────────────────────────────────────────────

  cancelAll(repositoryUrl: string): void {
    this._cancelFull(repositoryUrl);
    this._cancelIncremental(repositoryUrl);
  }

  private _cancelFull(repositoryUrl: string): void {
    this._fullSyncControllers.get(repositoryUrl)?.abort();
    this._fullSyncControllers.delete(repositoryUrl);
    this._inflight.delete(`full:${repositoryUrl}`);
  }

  private _cancelIncremental(repositoryUrl: string): void {
    this._incrementalSyncControllers.get(repositoryUrl)?.abort();
    this._incrementalSyncControllers.delete(repositoryUrl);
    this._inflight.delete(`incremental:${repositoryUrl}`);
  }
}

export const prSyncCoordinator = new PrSyncCoordinator();
