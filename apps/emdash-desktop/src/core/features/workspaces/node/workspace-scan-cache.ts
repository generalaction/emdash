import { type HostResourceRef } from '@emdash/core/primitives/host-resource/api';
import type { Observed } from '@emdash/core/primitives/lib/api';
import type {
  ProjectWorkspaceRow,
  ProjectWorkspacesResult,
  ProjectWorkspaceUsageResult,
} from '@core/primitives/workspaces/api';

const DEFAULT_MAX_AGE_MS = 30_000;

type WorkspaceScanCacheEntry = {
  result: Observed<ProjectWorkspacesResult>;
  refreshing?: Promise<void>;
  hostId?: string;
};

export class WorkspaceScanCache {
  private readonly entries = new Map<string, WorkspaceScanCacheEntry>();

  async getOrRefresh(
    projectId: string,
    refresh: () => Promise<ProjectWorkspacesResult>,
    options: { maxAgeMs?: number; hostId?: string } = {}
  ): Promise<ProjectWorkspacesResult> {
    const entry = this.entries.get(projectId);
    if (!entry) {
      return this.set(projectId, await refresh(), { hostId: options.hostId });
    }
    if (options.hostId && entry.hostId && entry.hostId !== options.hostId) {
      return this.set(projectId, await refresh(), { hostId: options.hostId });
    }
    if (options.hostId && !entry.hostId) entry.hostId = options.hostId;
    if (this.isStale(projectId, options.maxAgeMs)) {
      this.refreshInBackground(projectId, refresh, options.hostId);
    }
    return this.snapshot(entry);
  }

  get(projectId: string): ProjectWorkspacesResult | undefined {
    const entry = this.entries.get(projectId);
    return entry ? this.snapshot(entry) : undefined;
  }

  set(
    projectId: string,
    result: ProjectWorkspacesResult,
    options: { hostId?: string } = {}
  ): ProjectWorkspacesResult {
    const previous = this.entries.get(projectId);
    const entry: WorkspaceScanCacheEntry = {
      result: { value: this.cloneResult(result), observedAt: Date.now(), source: 'probe' },
      hostId: options.hostId ?? previous?.hostId,
    };
    this.entries.set(projectId, entry);
    return this.snapshot(entry);
  }

  isStale(projectId: string, maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
    const entry = this.entries.get(projectId);
    return !entry || Date.now() - entry.result.observedAt > maxAgeMs;
  }

  mergeUsageResults(projectId: string, results: readonly ProjectWorkspaceUsageResult[]): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    const usageByPath = new Map(
      results
        .filter(
          (result): result is Extract<ProjectWorkspaceUsageResult, { success: true }> =>
            result.success
        )
        .map((result) => [result.path, result.usage])
    );
    if (usageByPath.size === 0) return;
    const rows = entry.result.value.rows.map((row): ProjectWorkspaceRow => {
      const usage = usageByPath.get(row.path);
      return usage ? { ...row, usage } : row;
    });
    entry.result = {
      ...entry.result,
      value: {
        ...entry.result.value,
        rows,
        totalBytes: rows.reduce((sum, row) => sum + (row.usage?.totalBytes ?? 0), 0),
        artifactBytes: rows.reduce((sum, row) => sum + (row.usage?.artifactBytes ?? 0), 0),
      },
    };
  }

  evict(projectId: string, path?: string): void {
    if (!path) {
      this.entries.delete(projectId);
      return;
    }
    const entry = this.entries.get(projectId);
    if (!entry) return;
    const rows = entry.result.value.rows.filter((row) => row.path !== path);
    entry.result = {
      ...entry.result,
      value: {
        ...entry.result.value,
        rows,
        totalBytes: rows.reduce((sum, row) => sum + (row.usage?.totalBytes ?? 0), 0),
        artifactBytes: rows.reduce((sum, row) => sum + (row.usage?.artifactBytes ?? 0), 0),
      },
    };
  }

  evictPath(path: string): void {
    for (const projectId of this.entries.keys()) {
      this.evict(projectId, path);
    }
  }

  evictResource(resource: HostResourceRef): void {
    if (resource.kind !== 'worktree') return;
    for (const [projectId, entry] of this.entries) {
      if (entry.hostId && entry.hostId !== resource.hostId) continue;
      this.evict(projectId, resource.path);
    }
  }

  private refreshInBackground(
    projectId: string,
    refresh: () => Promise<ProjectWorkspacesResult>,
    hostId: string | undefined
  ): void {
    const entry = this.entries.get(projectId);
    if (!entry || entry.refreshing) return;
    entry.refreshing = refresh()
      .then((result) => {
        this.set(projectId, result, { hostId });
      })
      .finally(() => {
        const latest = this.entries.get(projectId);
        if (latest) latest.refreshing = undefined;
      });
  }

  private snapshot(entry: WorkspaceScanCacheEntry): ProjectWorkspacesResult {
    return this.cloneResult(entry.result.value);
  }

  private cloneResult(result: ProjectWorkspacesResult): ProjectWorkspacesResult {
    return {
      ...result,
      rows: result.rows.map((row) => ({ ...row, tasks: [...row.tasks], errors: [...row.errors] })),
      warnings: [...result.warnings],
    };
  }
}
