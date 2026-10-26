import type { Result } from '@emdash/shared';
import { createAsyncCache, type AsyncCache } from '@emdash/shared/concurrency';
import { waitWithSignal, type Clock } from '@emdash/shared/scheduling';
import { stableStringify } from '@emdash/shared/util';
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
  /** The project's preserve patterns decide what counts as an artifact; part of the identity. */
  preservePatterns: readonly string[];
  /** Registered workspaces inside this one are never its artifacts; part of the identity. */
  nestedWorkspacePaths: readonly string[];
};

/** A target as cached: the workspace's invalidation generation is part of its key. */
type CachedTarget = WorkspaceUsageTarget & { generation: number };

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
 * A workspace whose contents changed through the registry is invalidated on its own.
 */
export class WorkspaceUsageCache {
  private readonly cache: AsyncCache<CachedTarget, UsageResult>;
  private readonly waiters = new Map<string, number>();
  /** Bumped per workspace by {@link invalidate}; older entries are never served again. */
  private readonly generations = new Map<string, number>();

  constructor(options: WorkspaceUsageCacheOptions = {}) {
    const measure = options.measure ?? measureWorkspaceUsage;
    this.cache = createAsyncCache({
      key: usageTargetKey,
      label: 'workspace-usage',
      ttlMs: options.ttlMs ?? WORKSPACE_USAGE_TTL_MS,
      maxEntries: 1_000,
      clock: options.clock,
      load: ({ generation: _generation, ...target }, signal) => measure({ ...target, signal }),
    });
  }

  async measure(request: WorkspaceUsageTarget, signal?: AbortSignal): Promise<UsageResult> {
    signal?.throwIfAborted();
    const target = { ...request, generation: this.generations.get(request.workspaceId) ?? 0 };
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

  /**
   * Stops serving the workspace's measurements, whatever their nested exclusions:
   * the next request walks the tree again. Walks already in flight still settle for
   * the callers waiting on them; other workspaces keep their entries.
   */
  invalidate(workspaceId: string): void {
    this.generations.set(workspaceId, (this.generations.get(workspaceId) ?? 0) + 1);
  }

  dispose(): void {
    void this.cache.dispose();
  }
}

function usageTargetKey(target: CachedTarget): string {
  return stableStringify({
    ...target,
    excludePaths: [...target.excludePaths].sort(),
    preservePatterns: [...target.preservePatterns].sort(),
    nestedWorkspacePaths: [...target.nestedWorkspacePaths].sort(),
  });
}
