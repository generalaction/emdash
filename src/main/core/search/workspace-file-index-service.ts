import { basename } from 'node:path';
import type { Workspace } from '@main/core/workspaces/workspace';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { sqlite } from '@main/db/client';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { workspaceFileIndexUpdatedChannel } from '@shared/events/searchEvents';

const STALE_DAYS = 14;
const MAX_FILES = 50_000;
const CRAWL_TIMEOUT_MS = 30_000;
const SEARCH_INDEX_WAIT_MS = 250;
const REINDEX_DEBOUNCE_MS = 3_000;

const CRAWL_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  '.parcel-cache',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  '.terraform',
  '.serverless',
  'worktrees',
  '.emdash',
  '.conductor',
  '.cursor',
  '.claude',
  '.amp',
  '.codex',
  '.aider',
  '.continue',
  '.cody',
  '.windsurf',
]);

type FileHit = { path: string; filename: string };

class WorkspaceFileIndexService {
  private crawling = new Map<string, Promise<void>>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  initialize(): void {
    this.evictStale();

    events.on(fsWatchEventChannel, ({ workspaceId }) => {
      this.scheduleReindex(workspaceId);
    });
  }

  async onWorkspaceCreated(workspaceId: string, workspace: Workspace): Promise<void> {
    if (this.hasIndexEntries(workspaceId)) {
      this.touchMeta(workspaceId);
      return;
    }

    await this.crawl(workspaceId, workspace);
  }

  async prepareForSearch(workspaceId: string): Promise<void> {
    if (this.hasIndexEntries(workspaceId)) {
      this.touchMeta(workspaceId);
      return;
    }

    const workspace = workspaceRegistry.get(workspaceId);
    if (!workspace) return;
    await this.waitForSearchIndex(this.crawl(workspaceId, workspace));
  }

  onWorkspaceDestroyed(_workspaceId: string): void {
    // Intentionally a no-op: the index ages out 14 days after the last provision.
    // Calling touchMeta here would reset the staleness clock on every destroy,
    // preventing eviction of stale entries for frequently-cycled workspaces.
  }

  deleteIndex(workspaceId: string): void {
    try {
      sqlite.transaction(() => {
        sqlite.prepare(`DELETE FROM workspace_file_index WHERE workspace_id = ?`).run(workspaceId);
        sqlite
          .prepare(`DELETE FROM workspace_file_index_meta WHERE workspace_id = ?`)
          .run(workspaceId);
      })();
      log.info('WorkspaceFileIndexService: deleted index', { workspaceId });
    } catch (e) {
      log.warn('WorkspaceFileIndexService: deleteIndex failed', { workspaceId, error: String(e) });
    }
  }

  search(workspaceId: string, query: string): FileHit[] {
    const terms = query
      .trim()
      .split(/[\s\-_/]+/)
      .filter((t) => t.length >= 3);

    if (terms.length === 0) return [];

    const ftsQuery = terms.map((t) => `"${t}"`).join(' AND ');
    try {
      return sqlite
        .prepare(
          `SELECT path, filename
           FROM workspace_file_index
           WHERE workspace_file_index MATCH ?
             AND workspace_id = ?
           ORDER BY bm25(workspace_file_index, 1.0, 2.0)
           LIMIT 20`
        )
        .all(ftsQuery, workspaceId) as FileHit[];
    } catch (e) {
      log.warn('WorkspaceFileIndexService: search failed', { workspaceId, error: String(e) });
      return [];
    }
  }

  private async crawl(workspaceId: string, workspace: Workspace): Promise<void> {
    const existing = this.crawling.get(workspaceId);
    if (existing) return existing;

    const pending = this.crawlWorkspace(workspaceId, workspace).finally(() => {
      this.crawling.delete(workspaceId);
    });
    this.crawling.set(workspaceId, pending);
    return pending;
  }

  private async crawlWorkspace(workspaceId: string, workspace: Workspace): Promise<void> {
    try {
      const result = await workspace.fs.list('', {
        recursive: true,
        maxEntries: MAX_FILES,
        timeBudgetMs: CRAWL_TIMEOUT_MS,
      });

      const files = result.entries.filter(
        (e) => e.type === 'file' && !e.path.split('/').some((seg) => CRAWL_IGNORED_DIRS.has(seg))
      );

      sqlite.transaction(() => {
        sqlite.prepare(`DELETE FROM workspace_file_index WHERE workspace_id = ?`).run(workspaceId);
        const stmt = sqlite.prepare(
          `INSERT INTO workspace_file_index(workspace_id, path, filename) VALUES (?, ?, ?)`
        );
        for (const f of files) {
          stmt.run(workspaceId, f.path, basename(f.path));
        }
      })();

      this.touchMeta(workspaceId);
      events.emit(workspaceFileIndexUpdatedChannel, { workspaceId });
      log.info('WorkspaceFileIndexService: indexed workspace', {
        workspaceId,
        count: files.length,
        truncated: result.truncated ?? false,
      });
    } catch (e) {
      log.warn('WorkspaceFileIndexService: crawl failed', { workspaceId, error: String(e) });
    }
  }

  private async waitForSearchIndex(crawl: Promise<void>): Promise<void> {
    await Promise.race([
      crawl,
      new Promise<void>((resolve) => {
        setTimeout(resolve, SEARCH_INDEX_WAIT_MS);
      }),
    ]);
  }

  private hasIndexEntries(workspaceId: string): boolean {
    try {
      return !!sqlite
        .prepare(`SELECT 1 FROM workspace_file_index WHERE workspace_id = ? LIMIT 1`)
        .get(workspaceId);
    } catch (e) {
      log.warn('WorkspaceFileIndexService: hasIndexEntries failed', {
        workspaceId,
        error: String(e),
      });
      return false;
    }
  }

  private scheduleReindex(workspaceId: string): void {
    const existing = this.debounceTimers.get(workspaceId);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      workspaceId,
      setTimeout(() => {
        this.debounceTimers.delete(workspaceId);
        const ws = workspaceRegistry.get(workspaceId);
        if (ws) void this.crawl(workspaceId, ws);
      }, REINDEX_DEBOUNCE_MS)
    );
  }

  private touchMeta(workspaceId: string): void {
    try {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO workspace_file_index_meta (workspace_id, indexed_at)
           VALUES (?, unixepoch())`
        )
        .run(workspaceId);
    } catch (e) {
      log.warn('WorkspaceFileIndexService: touchMeta failed', { workspaceId, error: String(e) });
    }
  }

  private evictStale(): void {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - STALE_DAYS * 86400;
      const stale = sqlite
        .prepare(`SELECT workspace_id FROM workspace_file_index_meta WHERE indexed_at < ?`)
        .all(cutoff) as Array<{ workspace_id: string }>;

      if (stale.length > 0) {
        sqlite.transaction(() => {
          const delIndex = sqlite.prepare(
            `DELETE FROM workspace_file_index WHERE workspace_id = ?`
          );
          const delMeta = sqlite.prepare(
            `DELETE FROM workspace_file_index_meta WHERE workspace_id = ?`
          );
          for (const row of stale) {
            delIndex.run(row.workspace_id);
            delMeta.run(row.workspace_id);
          }
        })();
        log.info('WorkspaceFileIndexService: evicted stale indexes', { count: stale.length });
      }
    } catch (e) {
      log.warn('WorkspaceFileIndexService: evictStale failed', { error: String(e) });
    }

    try {
      const orphans = sqlite
        .prepare(
          `SELECT m.workspace_id
           FROM workspace_file_index_meta m
           LEFT JOIN workspaces w ON w.id = m.workspace_id
           LEFT JOIN tasks t ON t.workspace_id = m.workspace_id AND t.archived_at IS NULL
           WHERE w.id IS NULL OR t.id IS NULL`
        )
        .all() as Array<{ workspace_id: string }>;

      if (orphans.length === 0) return;

      sqlite.transaction(() => {
        const delIndex = sqlite.prepare(`DELETE FROM workspace_file_index WHERE workspace_id = ?`);
        const delMeta = sqlite.prepare(
          `DELETE FROM workspace_file_index_meta WHERE workspace_id = ?`
        );
        for (const row of orphans) {
          delIndex.run(row.workspace_id);
          delMeta.run(row.workspace_id);
        }
      })();

      log.info('WorkspaceFileIndexService: evicted orphan indexes', { count: orphans.length });
    } catch (e) {
      log.warn('WorkspaceFileIndexService: evictOrphans failed', { error: String(e) });
    }
  }
}

export const workspaceFileIndexService = new WorkspaceFileIndexService();
