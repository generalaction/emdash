import type { FsError } from '@emdash/core/files';
import type { Result } from '@emdash/shared';
import type { FileExclusionPredicate } from '@main/core/files/scoped-file-system';
import { log } from '@main/lib/logger';
import { collectWithBudget } from './collect-with-budget';
import { createSearchIndexExclusion } from './search-index-exclusions';
import {
  WorkspaceFileIndexStore,
  type FileHit,
  type IWorkspaceFileIndexStore,
} from './workspace-file-index-store';

const STALE_DAYS = 14;
const DEFAULT_MAX_FILES = 50_000;
const DEFAULT_REINDEX_TIMEOUT_MS = 30_000;
const DEFAULT_SEARCH_REFRESH_INTERVAL_MS = 15_000;

type EnumerationOptions = {
  exclude?: FileExclusionPredicate;
  includeSymlinkFiles?: boolean;
};

export type WorkspaceFileEnumerator = (
  rootPath: string,
  options?: EnumerationOptions
) => Result<AsyncIterable<string>, FsError>;

export type WorkspaceFileIndexSource = {
  rootPath: string;
  enumerate: WorkspaceFileEnumerator;
};

export type WorkspaceFileIndexServiceOptions = {
  store?: IWorkspaceFileIndexStore;
  maxFiles?: number;
  reindexTimeoutMs?: number;
  searchRefreshIntervalMs?: number;
  now?: () => number;
};

export class WorkspaceFileIndexService {
  private readonly store: IWorkspaceFileIndexStore;
  private readonly reindexing = new Set<string>();
  private readonly pendingReindex = new Set<string>();
  private readonly activeSources = new Map<string, WorkspaceFileIndexSource>();
  private readonly lastReindexAt = new Map<string, number>();

  constructor(private readonly options: WorkspaceFileIndexServiceOptions = {}) {
    this.store = options.store ?? new WorkspaceFileIndexStore();
  }

  initialize(): void {
    this.store.evict(STALE_DAYS);
  }

  async onWorkspaceActivated(workspaceId: string, source: WorkspaceFileIndexSource): Promise<void> {
    this.activeSources.set(workspaceId, source);
    const meta = this.store.getMeta(workspaceId);
    if (meta && meta.rootPath !== source.rootPath) this.store.deleteIndex(workspaceId);
    await this.reindex(workspaceId);
  }

  onWorkspaceDeactivated(workspaceId: string): void {
    this.activeSources.delete(workspaceId);
    this.pendingReindex.delete(workspaceId);
    this.lastReindexAt.delete(workspaceId);
  }

  refreshWorkspace(workspaceId: string): Promise<void> {
    return this.reindex(workspaceId);
  }

  deleteIndex(workspaceId: string): void {
    this.store.deleteIndex(workspaceId);
  }

  searchFiles(workspaceId: string, query: string, limit = 20): FileHit[] {
    this.refreshForSearch(workspaceId);
    return this.store.searchFiles(workspaceId, query, limit);
  }

  search(workspaceId: string, query: string): FileHit[] {
    this.refreshForSearch(workspaceId);
    return this.store.search(workspaceId, query);
  }

  private async reindex(workspaceId: string): Promise<void> {
    if (this.reindexing.has(workspaceId)) {
      this.pendingReindex.add(workspaceId);
      return;
    }
    this.reindexing.add(workspaceId);
    try {
      do {
        this.pendingReindex.delete(workspaceId);
        const source = this.activeSources.get(workspaceId);
        if (!source) return;
        const exclude = createSearchIndexExclusion(source.rootPath);
        const enumeration = source.enumerate(source.rootPath, { exclude });
        if (!enumeration.success) {
          log.warn('WorkspaceFileIndexService: enumerate failed to start', {
            workspaceId,
            error: enumeration.error,
          });
          return;
        }
        const result = await collectWithBudget(filterExcluded(enumeration.data, exclude), {
          maxFiles: this.maxFiles,
          timeoutMs: this.reindexTimeoutMs,
          now: this.options.now,
        });
        if (this.activeSources.get(workspaceId) !== source) {
          this.pendingReindex.add(workspaceId);
          continue;
        }
        this.store.transaction(() => {
          this.store.syncRows(workspaceId, result.paths);
          this.store.recordMeta(workspaceId, {
            rootPath: source.rootPath,
            status: result.truncated ? 'truncated' : 'complete',
            fileCount: result.paths.length,
            truncateReason: result.truncateReason ?? null,
          });
        });
        this.lastReindexAt.set(workspaceId, this.now());
      } while (this.pendingReindex.has(workspaceId));
    } catch (error) {
      log.warn('WorkspaceFileIndexService: reindex failed', {
        workspaceId,
        error: String(error),
      });
    } finally {
      this.reindexing.delete(workspaceId);
    }
  }

  private get maxFiles(): number {
    return this.options.maxFiles ?? DEFAULT_MAX_FILES;
  }

  private get reindexTimeoutMs(): number {
    return this.options.reindexTimeoutMs ?? DEFAULT_REINDEX_TIMEOUT_MS;
  }

  private refreshForSearch(workspaceId: string): void {
    if (!this.activeSources.has(workspaceId) || this.reindexing.has(workspaceId)) return;
    const lastReindex = this.lastReindexAt.get(workspaceId) ?? 0;
    const interval = this.options.searchRefreshIntervalMs ?? DEFAULT_SEARCH_REFRESH_INTERVAL_MS;
    if (this.now() - lastReindex < interval) return;
    void this.reindex(workspaceId);
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

async function* filterExcluded(
  entries: AsyncIterable<string>,
  exclude: FileExclusionPredicate
): AsyncIterable<string> {
  for await (const entry of entries) {
    if (!exclude(entry)) yield entry;
  }
}

export const workspaceFileIndexService = new WorkspaceFileIndexService();
