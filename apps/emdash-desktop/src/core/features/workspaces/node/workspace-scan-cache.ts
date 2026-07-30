import type { WorkspaceOperationRecord } from '@emdash/core/runtimes/workspace/api';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type {
  GetProjectWorkspaceGitStatsResult,
  ProjectWorkspaceGitStatsResult,
  ProjectWorkspaceRow,
  ProjectWorkspacesResult,
  ProjectWorkspaceUsageResult,
} from '@core/primitives/workspaces/api';

const DEFAULT_MAX_AGE_MS = 30_000;

type WorkspaceScanCacheEntry = {
  result: ProjectWorkspacesResult;
  cachedAt: number;
  refreshing?: Promise<void>;
  gitStatsByPath: Map<string, ProjectWorkspaceGitStatsResult>;
};

export class WorkspaceScanCache {
  private readonly entries = new Map<string, WorkspaceScanCacheEntry>();

  async getOrRefresh(
    projectId: string,
    refresh: () => Promise<ProjectWorkspacesResult>,
    options: { maxAgeMs?: number } = {}
  ): Promise<ProjectWorkspacesResult> {
    const entry = this.entries.get(projectId);
    if (!entry) {
      return this.set(projectId, await refresh());
    }
    if (this.isStale(projectId, options.maxAgeMs)) {
      this.refreshInBackground(projectId, refresh);
    }
    return this.snapshot(entry);
  }

  get(projectId: string): ProjectWorkspacesResult | undefined {
    const entry = this.entries.get(projectId);
    return entry ? this.snapshot(entry) : undefined;
  }

  set(projectId: string, result: ProjectWorkspacesResult): ProjectWorkspacesResult {
    const previous = this.entries.get(projectId);
    const entry: WorkspaceScanCacheEntry = {
      result: this.cloneResult(result),
      cachedAt: Date.now(),
      gitStatsByPath: previous?.gitStatsByPath ?? new Map(),
    };
    this.entries.set(projectId, entry);
    return this.snapshot(entry);
  }

  isStale(projectId: string, maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
    const entry = this.entries.get(projectId);
    return !entry || Date.now() - entry.cachedAt > maxAgeMs;
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
    const rows = entry.result.rows.map((row): ProjectWorkspaceRow => {
      const usage = usageByPath.get(row.path);
      return usage ? { ...row, usage } : row;
    });
    entry.result = {
      ...entry.result,
      rows,
      totalBytes: rows.reduce((sum, row) => sum + (row.usage?.totalBytes ?? 0), 0),
      artifactBytes: rows.reduce((sum, row) => sum + (row.usage?.artifactBytes ?? 0), 0),
    };
  }

  mergeGitStatsResults(projectId: string, result: GetProjectWorkspaceGitStatsResult): void {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    for (const item of result.results) {
      entry.gitStatsByPath.set(item.path, item);
    }
  }

  evict(projectId: string, path?: string): void {
    if (!path) {
      this.entries.delete(projectId);
      return;
    }
    const entry = this.entries.get(projectId);
    if (!entry) return;
    const rows = entry.result.rows.filter((row) => row.path !== path);
    entry.gitStatsByPath.delete(path);
    entry.result = {
      ...entry.result,
      rows,
      totalBytes: rows.reduce((sum, row) => sum + (row.usage?.totalBytes ?? 0), 0),
      artifactBytes: rows.reduce((sum, row) => sum + (row.usage?.artifactBytes ?? 0), 0),
    };
  }

  evictPath(path: string): void {
    for (const projectId of this.entries.keys()) {
      this.evict(projectId, path);
    }
  }

  evictTerminalRecord(record: WorkspaceOperationRecord): void {
    if (
      record.status !== 'succeeded' ||
      (record.kind !== 'teardown' && record.kind !== 'clean-artifacts')
    ) {
      return;
    }
    this.evictPath(nativePathFromHost(record.workspace.path));
  }

  private refreshInBackground(
    projectId: string,
    refresh: () => Promise<ProjectWorkspacesResult>
  ): void {
    const entry = this.entries.get(projectId);
    if (!entry || entry.refreshing) return;
    entry.refreshing = refresh()
      .then((result) => {
        this.set(projectId, result);
      })
      .finally(() => {
        const latest = this.entries.get(projectId);
        if (latest) latest.refreshing = undefined;
      });
  }

  private snapshot(entry: WorkspaceScanCacheEntry): ProjectWorkspacesResult {
    return this.cloneResult(entry.result);
  }

  private cloneResult(result: ProjectWorkspacesResult): ProjectWorkspacesResult {
    return {
      ...result,
      rows: result.rows.map((row) => ({ ...row, tasks: [...row.tasks], errors: [...row.errors] })),
      warnings: [...result.warnings],
    };
  }
}
