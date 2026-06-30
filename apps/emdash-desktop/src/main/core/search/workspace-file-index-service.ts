import {
  type FileChange,
  type FileChangeUpdate,
  type FileEnumerationOptions,
  type FileError,
} from '@emdash/core/files';
import type { Result } from '@emdash/shared';
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
const DEFAULT_REINDEX_DEBOUNCE_MS = 3_000;

export type WorkspaceFileEnumerator = (
  rootPath: string,
  options?: FileEnumerationOptions
) => Result<AsyncIterable<string>, FileError>;

export type WorkspaceFileIndexSource = {
  rootPath: string;
  enumerate: WorkspaceFileEnumerator;
};

export type WorkspaceFileIndexServiceOptions = {
  store?: IWorkspaceFileIndexStore;
  maxFiles?: number;
  reindexTimeoutMs?: number;
  reindexDebounceMs?: number;
  now?: () => number;
};

export class WorkspaceFileIndexService {
  private readonly store: IWorkspaceFileIndexStore;
  private reindexing = new Set<string>();
  private pendingReindex = new Set<string>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private activeSources = new Map<string, WorkspaceFileIndexSource>();

  constructor(private readonly options: WorkspaceFileIndexServiceOptions = {}) {
    this.store = options.store ?? new WorkspaceFileIndexStore();
  }

  initialize(): void {
    this.store.evict(STALE_DAYS);
  }

  onWorkspaceFileChange(workspaceId: string, update: FileChangeUpdate): void {
    if (update.kind === 'resync') {
      this.scheduleReindex(workspaceId);
      return;
    }
    if (update.changes.length === 0) return;

    const meta = this.store.getMeta(workspaceId);
    if (this.reindexing.has(workspaceId) || !meta) {
      this.scheduleReindex(workspaceId);
      return;
    }
    if (meta.status === 'stale') {
      this.scheduleReindex(workspaceId);
      return;
    }
    if (meta.status === 'truncated') return;

    this.applyChanges(workspaceId, update.changes);
  }

  async onWorkspaceActivated(workspaceId: string, source: WorkspaceFileIndexSource): Promise<void> {
    this.activeSources.set(workspaceId, source);
    const meta = this.store.getMeta(workspaceId);

    if (meta && meta.rootPath !== source.rootPath) {
      this.store.deleteIndex(workspaceId);
      await this.reindex(workspaceId);
      return;
    }

    if (meta?.status === 'complete') {
      this.store.refreshMetaTimestamp(workspaceId);
      return;
    }

    await this.reindex(workspaceId);
  }

  onWorkspaceDeactivated(workspaceId: string): void {
    // Do not touch meta here: that would reset the staleness clock on every destroy
    // and prevent eviction of stale entries for frequently-cycled workspaces.
    this.activeSources.delete(workspaceId);
    this.pendingReindex.delete(workspaceId);
    this.clearDebounceTimer(workspaceId);
  }

  deleteIndex(workspaceId: string): void {
    this.store.deleteIndex(workspaceId);
  }

  search(workspaceId: string, query: string): FileHit[] {
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
        if (this.activeSources.get(workspaceId) !== source) return;

        this.store.transaction(() => {
          this.store.syncRows(workspaceId, result.paths);
          this.store.recordMeta(workspaceId, {
            rootPath: source.rootPath,
            status: result.truncated ? 'truncated' : 'complete',
            fileCount: result.paths.length,
            truncateReason: result.truncateReason ?? null,
          });
        });

        const logPayload = {
          workspaceId,
          count: result.paths.length,
          truncated: result.truncated,
          truncateReason: result.truncateReason,
        };
        if (result.truncated) {
          log.warn('WorkspaceFileIndexService: indexed partial workspace', logPayload);
        } else {
          log.info('WorkspaceFileIndexService: indexed workspace', logPayload);
        }
      } while (this.pendingReindex.has(workspaceId));
    } catch (e) {
      log.warn('WorkspaceFileIndexService: reindex failed', { workspaceId, error: String(e) });
    } finally {
      this.reindexing.delete(workspaceId);
    }
  }

  private applyChanges(workspaceId: string, changes: FileChange[]): void {
    let needsReindex = false;
    const rootPath = this.metaRootPath(workspaceId);
    const exclude = createSearchIndexExclusion(rootPath);
    try {
      this.store.transaction(() => {
        let indexedFileCount = this.store.countIndexedFiles(workspaceId);
        let needsCountRefresh = false;
        const creates: string[] = [];

        for (const change of changes) {
          if (exclude(change.path)) continue;

          if (change.kind === 'delete') {
            if (change.entryType === 'file') {
              if (this.store.deletePath(workspaceId, change.path)) {
                indexedFileCount = Math.max(0, indexedFileCount - 1);
              }
            } else {
              this.store.deleteSubtree(workspaceId, change.path);
              needsCountRefresh = true;
            }
            continue;
          }

          if (change.entryType === 'directory') {
            needsReindex = true;
            continue;
          }

          if (change.kind === 'create') {
            creates.push(change.path);
          }
        }

        if (needsCountRefresh) {
          indexedFileCount = this.store.countIndexedFiles(workspaceId);
        }

        for (const path of creates) {
          if (indexedFileCount >= this.maxFiles) {
            needsReindex = true;
            continue;
          }

          const added = this.store.insertPath(workspaceId, path);
          if (added) indexedFileCount += 1;
        }
      });

      if (needsReindex) {
        this.markStale(workspaceId);
        this.scheduleReindex(workspaceId);
        return;
      }

      this.store.recordMeta(workspaceId, {
        rootPath: this.metaRootPath(workspaceId),
        status: 'complete',
        fileCount: this.store.countIndexedFiles(workspaceId),
        truncateReason: null,
      });
    } catch (e) {
      log.warn('WorkspaceFileIndexService: incremental update failed', {
        workspaceId,
        error: String(e),
      });
      this.markStale(workspaceId);
      this.scheduleReindex(workspaceId);
    }
  }

  private scheduleReindex(workspaceId: string): void {
    if (!this.activeSources.has(workspaceId)) return;
    this.clearDebounceTimer(workspaceId);

    this.debounceTimers.set(
      workspaceId,
      setTimeout(() => {
        this.debounceTimers.delete(workspaceId);
        void this.reindex(workspaceId);
      }, this.reindexDebounceMs)
    );
  }

  private clearDebounceTimer(workspaceId: string): void {
    const timer = this.debounceTimers.get(workspaceId);
    if (timer) clearTimeout(timer);
    this.debounceTimers.delete(workspaceId);
  }

  private markStale(workspaceId: string): void {
    try {
      this.store.recordMeta(workspaceId, {
        rootPath: this.metaRootPath(workspaceId),
        status: 'stale',
        fileCount: this.store.countIndexedFiles(workspaceId),
        truncateReason: null,
      });
    } catch (e) {
      log.warn('WorkspaceFileIndexService: markStale failed', { workspaceId, error: String(e) });
    }
  }

  private get maxFiles(): number {
    return this.options.maxFiles ?? DEFAULT_MAX_FILES;
  }

  private get reindexTimeoutMs(): number {
    return this.options.reindexTimeoutMs ?? DEFAULT_REINDEX_TIMEOUT_MS;
  }

  private get reindexDebounceMs(): number {
    return this.options.reindexDebounceMs ?? DEFAULT_REINDEX_DEBOUNCE_MS;
  }

  private metaRootPath(workspaceId: string): string {
    return (
      this.activeSources.get(workspaceId)?.rootPath ??
      this.store.getMeta(workspaceId)?.rootPath ??
      ''
    );
  }
}

async function* filterExcluded(
  paths: AsyncIterable<string>,
  exclude: (absPath: string) => boolean
): AsyncIterable<string> {
  for await (const path of paths) {
    if (!exclude(path)) yield path;
  }
}

export const workspaceFileIndexService = new WorkspaceFileIndexService({
  store: new WorkspaceFileIndexStore(),
});
