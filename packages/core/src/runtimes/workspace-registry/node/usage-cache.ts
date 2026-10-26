import type { Result } from '@emdash/shared';
import { createAsyncCache, type AsyncCache } from '@emdash/shared/concurrency';
import { waitWithSignal, type Clock } from '@emdash/shared/scheduling';
import type { WorkspaceUsage } from '../api/schemas';
import {
  measureWorkspaceUsage,
  type MeasureWorkspaceUsageError,
  type MeasureWorkspaceUsageOptions,
} from './measure-usage';

/** How long a measured footprint is served before the next request walks the tree again. */
export const WORKSPACE_USAGE_TTL_MS = 5 * 60_000;

export type WorkspaceUsageTarget = {
  workspaceId: string;
  workspacePath: string;
  /** Nested workspaces measured on their own; part of the identity of a measurement. */
  excludePaths: string[];
};

type UsageResult = Result<WorkspaceUsage, MeasureWorkspaceUsageError>;

export type WorkspaceUsageCacheOptions = {
  clock?: Clock;
  ttlMs?: number;
  /** Test seam; production walks the real filesystem. */
  measure?: (options: MeasureWorkspaceUsageOptions) => Promise<UsageResult>;
};

/**
 * One disk walk per workspace, shared by every concurrent caller and served for
 * `ttlMs`: reopening the Workspaces view or re-keying its query reads the cache
 * instead of walking every tree again. A walk is cancelled only once every caller
 * waiting on it has gone away, so one closed view never cancels another's scan.
 * Failures reach the callers waiting at the time and are retried by the next request.
 */
export class WorkspaceUsageCache {
  private readonly cache: AsyncCache<WorkspaceUsageTarget, UsageResult>;
  private readonly waiters = new Map<string, number>();

  constructor(options: WorkspaceUsageCacheOptions = {}) {
    const measure = options.measure ?? measureWorkspaceUsage;
    this.cache = createAsyncCache({
      key: usageTargetKey,
      label: 'workspace-usage',
      ttlMs: options.ttlMs ?? WORKSPACE_USAGE_TTL_MS,
      maxEntries: 1_000,
      clock: options.clock,
      load: (target, signal) => measure({ ...target, signal }),
    });
  }

  async measure(target: WorkspaceUsageTarget, signal?: AbortSignal): Promise<UsageResult> {
    signal?.throwIfAborted();
    const key = usageTargetKey(target);
    const shared = this.cache.get(target);
    let settled = false;
    void shared.then(
      () => (settled = true),
      () => (settled = true)
    );
    this.waiters.set(key, (this.waiters.get(key) ?? 0) + 1);
    try {
      const result = await (signal ? waitWithSignal(shared, signal) : shared);
      if (!result.success) this.cache.invalidate(target);
      return result;
    } finally {
      const remaining = (this.waiters.get(key) ?? 1) - 1;
      if (remaining > 0) {
        this.waiters.set(key, remaining);
      } else {
        this.waiters.delete(key);
        if (!settled) this.cache.invalidate(target);
      }
    }
  }

  dispose(): void {
    void this.cache.dispose();
  }
}

function usageTargetKey(target: WorkspaceUsageTarget): string {
  return [target.workspaceId, target.workspacePath, ...[...target.excludePaths].sort()].join('\0');
}
