import { basename } from 'node:path';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import type { Workspace } from '@main/core/workspaces/workspace';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { sqlite } from '@main/db/client';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

const STALE_DAYS = 14;
const MAX_FILES = 50_000;
const CRAWL_TIMEOUT_MS = 30_000;
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
  private crawling = new Set<string>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  initialize(): void {
    this.evictStale();

    events.on(fsWatchEventChannel, ({ workspaceId }) => {
      this.scheduleReindex(workspaceId);
    });
  }

  async onWorkspaceCreated(workspaceId: string, workspace: Workspace): Promise<void> {
    const alreadyIndexed = sqlite
      .prepare(`SELECT 1 FROM workspace_file_index_meta WHERE workspace_id = ?`)
      .get(workspaceId);

    if (alreadyIndexed) {
      this.touchMeta(workspaceId);
      return;
    }

    await this.crawl(workspaceId, workspace);
  }

  onWorkspaceDestroyed(workspaceId: string): void {
    this.touchMeta(workspaceId);
  }

  search(workspaceId: string, query: string): FileHit[] {
    const terms = query
      .trim()
      .split(/[\s\-_/]+/)
      .filter((t) => t.length >= 3);

    if (terms.length === 0) return [];

    const ftsQuery = terms.join(' AND ');
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
    if (this.crawling.has(workspaceId)) return;
    this.crawling.add(workspaceId);

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
      log.info('WorkspaceFileIndexService: indexed workspace', {
        workspaceId,
        count: files.length,
        truncated: result.truncated ?? false,
      });
    } catch (e) {
      log.warn('WorkspaceFileIndexService: crawl failed', { workspaceId, error: String(e) });
    } finally {
      this.crawling.delete(workspaceId);
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

      if (stale.length === 0) return;

      sqlite.transaction(() => {
        const delIndex = sqlite.prepare(`DELETE FROM workspace_file_index WHERE workspace_id = ?`);
        const delMeta = sqlite.prepare(
          `DELETE FROM workspace_file_index_meta WHERE workspace_id = ?`
        );
        for (const row of stale) {
          delIndex.run(row.workspace_id);
          delMeta.run(row.workspace_id);
        }
      })();

      log.info('WorkspaceFileIndexService: evicted stale indexes', { count: stale.length });
    } catch (e) {
      log.warn('WorkspaceFileIndexService: evictStale failed', { error: String(e) });
    }
  }
}

export const workspaceFileIndexService = new WorkspaceFileIndexService();
