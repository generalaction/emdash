import type { Project } from '@shared/projects';
import type { CommandPaletteQuery, SearchItem, SearchItemKind } from '@shared/search';
import type { Task } from '@shared/tasks';
import { db, sqlite } from '@main/db/client';
import { projects, tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { projectEvents } from '../projects/project-events';
import { taskEvents } from '../tasks/task-events';

type FtsRow = {
  item_type: string;
  item_id: string;
  project_id: string | null;
  title: string;
  rank: number;
};

type RecentRow = {
  id: string;
  name: string;
  project_id: string;
};

class SearchService {
  initialize(): void {
    taskEvents.on('task:created', (task) => this.upsertTask(task));
    taskEvents.on('task:updated', (task) => this.upsertTask(task));
    taskEvents.on('task:archived', (taskId) => this.remove(taskId));
    taskEvents.on('task:deleted', (taskId) => this.remove(taskId));

    projectEvents.on('project:created', (project) => this.upsertProject(project));
    projectEvents.on('project:deleted', (projectId) => this.remove(projectId));

    this.backfill();
  }

  search({ query, context }: CommandPaletteQuery): SearchItem[] {
    if (!query.trim()) return this.recents(context);

    const ftsQuery = query
      .trim()
      .split(/[\s\-_]+/)
      .filter(Boolean)
      .map((t) => `${t}*`)
      .join(' AND ');

    let rows: FtsRow[];
    try {
      rows = sqlite
        .prepare(
          `SELECT item_type, item_id, project_id, title, bm25(search_index) AS rank
           FROM search_index
           WHERE search_index MATCH ?
           ORDER BY rank
           LIMIT 30`
        )
        .all(ftsQuery) as FtsRow[];
    } catch (e) {
      log.warn('SearchService: FTS query failed', { query, error: String(e) });
      return [];
    }

    return rows.map((r) => ({
      kind: r.item_type as SearchItemKind,
      id: r.item_id,
      projectId: r.project_id,
      title: r.title,
      subtitle: '',
      score: r.rank,
    }));
  }

  private recents(context?: CommandPaletteQuery['context']): SearchItem[] {
    const stmt = context?.projectId
      ? sqlite.prepare(
          `SELECT t.id, t.name, t.project_id
           FROM tasks t
           WHERE t.archived_at IS NULL AND t.project_id = ?
           ORDER BY t.last_interacted_at DESC
           LIMIT 10`
        )
      : sqlite.prepare(
          `SELECT t.id, t.name, t.project_id
           FROM tasks t
           WHERE t.archived_at IS NULL
           ORDER BY t.last_interacted_at DESC
           LIMIT 10`
        );

    const rows = (context?.projectId ? stmt.all(context.projectId) : stmt.all()) as RecentRow[];

    return rows.map((r) => ({
      kind: 'task' as const,
      id: r.id,
      projectId: r.project_id,
      title: r.name,
      subtitle: '',
      score: 0,
    }));
  }

  private upsertTask(task: Task): void {
    const keywords = [task.taskBranch, task.linkedIssue?.identifier, task.linkedIssue?.title]
      .filter(Boolean)
      .join(' ');

    try {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, title, keywords)
           VALUES ('task', ?, ?, ?, ?)`
        )
        .run(task.id, task.projectId, task.name, keywords);
    } catch (e) {
      log.warn('SearchService: upsertTask failed', { taskId: task.id, error: String(e) });
    }
  }

  private upsertProject(project: Project): void {
    try {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, title, keywords)
           VALUES ('project', ?, NULL, ?, ?)`
        )
        .run(project.id, project.name, project.path);
    } catch (e) {
      log.warn('SearchService: upsertProject failed', {
        projectId: project.id,
        error: String(e),
      });
    }
  }

  private remove(itemId: string): void {
    try {
      sqlite.prepare(`DELETE FROM search_index WHERE item_id = ?`).run(itemId);
    } catch (e) {
      log.warn('SearchService: remove failed', { itemId, error: String(e) });
    }
  }

  private backfill(): void {
    try {
      const count = (
        sqlite.prepare(`SELECT count(*) as n FROM search_index`).get() as { n: number }
      ).n;

      if (count > 0) return;

      const allTasks = db.select().from(tasks).all();
      const allProjects = db.select().from(projects).all();

      const upsertStmt = sqlite.prepare(
        `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, title, keywords)
         VALUES (?, ?, ?, ?, ?)`
      );

      sqlite.transaction(() => {
        for (const t of allTasks) {
          if (t.archivedAt) continue;
          upsertStmt.run('task', t.id, t.projectId, t.name, t.taskBranch ?? '');
        }
        for (const p of allProjects) {
          upsertStmt.run('project', p.id, null, p.name, p.path);
        }
      })();

      log.info('SearchService: backfilled search index', {
        tasks: allTasks.filter((t) => !t.archivedAt).length,
        projects: allProjects.length,
      });
    } catch (e) {
      log.warn('SearchService: backfill failed', { error: String(e) });
    }
  }
}

export const searchService = new SearchService();
