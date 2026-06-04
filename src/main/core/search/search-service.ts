import { eq } from 'drizzle-orm';
import { db, sqlite } from '@main/db/client';
import { conversations, projects, tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { ALL_COMMAND_DEFS } from '@shared/commands';
import type { Conversation } from '@shared/conversations';
import type { Project } from '@shared/projects';
import type { CommandPaletteQuery, SearchItem, SearchItemKind } from '@shared/search';
import type { Task } from '@shared/tasks';
import { conversationEvents } from '../conversations/conversation-events';
import { projectEvents } from '../projects/project-events';
import { taskService } from '../tasks/task-service';
import { workspaceFileIndexService } from './workspace-file-index-service';

type FtsRow = {
  item_type: string;
  item_id: string;
  project_id: string | null;
  task_id: string | null;
  title: string;
  rank: number;
};

type RecentTaskRow = {
  id: string;
  name: string;
  project_id: string;
};

type RecentConversationRow = {
  id: string;
  title: string;
  project_id: string;
  task_id: string;
};

class SearchService {
  initialize(): void {
    taskService.on('task:created', (task) => void this.upsertTaskWithBranch(task));
    taskService.on('task:updated', (task) => void this.upsertTaskWithBranch(task));
    taskService.on('task:archived', (taskId) => this.removeByType('task', taskId));
    taskService.on('task:deleted', (taskId) => this.removeByType('task', taskId));

    projectEvents.on('project:created', (project) => this.upsertProject(project));
    projectEvents.on('project:deleted', (projectId) => this.removeByType('project', projectId));

    conversationEvents.on('conversation:created', (conversation) =>
      this.upsertConversation(conversation)
    );
    conversationEvents.on('conversation:renamed', (conversationId, projectId, taskId, newTitle) => {
      this.upsertConversationById(conversationId, projectId, taskId, newTitle);
    });
    conversationEvents.on('conversation:deleted', (conversationId) =>
      this.removeByType('conversation', conversationId)
    );

    this.backfill();
    this.seedCommands();
  }

  search({ query, context }: CommandPaletteQuery): SearchItem[] {
    if (!query.trim()) return this.recents(context);

    // Trigram tokenizer requires each term to be at least 3 characters.
    // Terms shorter than 3 chars are dropped; if nothing survives, fall back
    // to recents rather than sending an invalid query to SQLite.
    const terms = query
      .trim()
      .split(/[\s\-_]+/)
      .filter((t) => t.length >= 3);

    if (terms.length === 0) return this.recents(context);

    const ftsQuery = terms.map((t) => `"${t}"`).join(' AND ');

    let rows: FtsRow[];
    try {
      if (context?.taskId) {
        rows = sqlite
          .prepare(
            `SELECT item_type, item_id, project_id, task_id, title, bm25(search_index) AS rank
             FROM search_index
             WHERE search_index MATCH ?
               AND (item_type != 'conversation' OR task_id = ?)
             ORDER BY rank
             LIMIT 30`
          )
          .all(ftsQuery, context.taskId) as FtsRow[];
      } else {
        rows = sqlite
          .prepare(
            `SELECT item_type, item_id, project_id, task_id, title, bm25(search_index) AS rank
             FROM search_index
             WHERE search_index MATCH ?
               AND item_type != 'conversation'
             ORDER BY rank
             LIMIT 30`
          )
          .all(ftsQuery) as FtsRow[];
      }
    } catch (e) {
      log.warn('SearchService: FTS query failed', { query, error: String(e) });
      return [];
    }

    const results: SearchItem[] = rows.map((r) => ({
      kind: r.item_type as SearchItemKind,
      id: r.item_id,
      projectId: r.project_id,
      taskId: r.task_id,
      title: r.title,
      subtitle: '',
      score: r.rank,
    }));

    if (context?.workspaceId) {
      const fileHits = workspaceFileIndexService.search(context.workspaceId, query);
      for (const h of fileHits) {
        results.push({
          kind: 'file',
          id: h.path,
          projectId: context.projectId ?? null,
          taskId: context.taskId ?? null,
          title: h.filename,
          subtitle: h.path,
          score: 0,
        });
      }
    }

    return results;
  }

  private recents(context?: CommandPaletteQuery['context']): SearchItem[] {
    const taskStmt = context?.projectId
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

    const taskRows = (
      context?.projectId ? taskStmt.all(context.projectId) : taskStmt.all()
    ) as RecentTaskRow[];

    const results: SearchItem[] = taskRows.map((r) => ({
      kind: 'task' as const,
      id: r.id,
      projectId: r.project_id,
      taskId: null,
      title: r.name,
      subtitle: '',
      score: 0,
    }));

    if (context?.taskId) {
      const conversationRows = sqlite
        .prepare(
          `SELECT c.id, c.title, c.project_id, c.task_id
           FROM conversations c
           WHERE c.task_id = ?
           ORDER BY c.last_interacted_at DESC
           LIMIT 10`
        )
        .all(context.taskId) as RecentConversationRow[];

      for (const r of conversationRows) {
        results.push({
          kind: 'conversation',
          id: r.id,
          projectId: r.project_id,
          taskId: r.task_id,
          title: r.title,
          subtitle: '',
          score: 0,
        });
      }
    }

    return results;
  }

  private async upsertTaskWithBranch(task: Task): Promise<void> {
    let branchName: string | undefined;
    if (task.workspaceId) {
      const [ws] = await db
        .select({ branchName: workspaces.branchName })
        .from(workspaces)
        .where(eq(workspaces.id, task.workspaceId))
        .limit(1);
      branchName = ws?.branchName ?? undefined;
    }
    this.upsertTask(task, branchName);
  }

  private upsertTask(task: Task, branchName?: string): void {
    const keywords = [branchName, task.linkedIssue?.identifier, task.linkedIssue?.title]
      .filter(Boolean)
      .join(' ');

    try {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, title, keywords)
           VALUES ('task', ?, ?, NULL, ?, ?)`
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
          `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, title, keywords)
           VALUES ('project', ?, NULL, NULL, ?, ?)`
        )
        .run(project.id, project.name, project.path);
    } catch (e) {
      log.warn('SearchService: upsertProject failed', {
        projectId: project.id,
        error: String(e),
      });
    }
  }

  private upsertConversation(conversation: Conversation): void {
    try {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, title, keywords)
           VALUES ('conversation', ?, ?, ?, ?, '')`
        )
        .run(conversation.id, conversation.projectId, conversation.taskId, conversation.title);
    } catch (e) {
      log.warn('SearchService: upsertConversation failed', {
        conversationId: conversation.id,
        error: String(e),
      });
    }
  }

  private upsertConversationById(
    conversationId: string,
    projectId: string,
    taskId: string,
    title: string
  ): void {
    try {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, title, keywords)
           VALUES ('conversation', ?, ?, ?, ?, '')`
        )
        .run(conversationId, projectId, taskId, title);
    } catch (e) {
      log.warn('SearchService: upsertConversationById failed', {
        conversationId,
        error: String(e),
      });
    }
  }

  private removeByType(itemType: string, itemId: string): void {
    try {
      sqlite
        .prepare(`DELETE FROM search_index WHERE item_id = ? AND item_type = ?`)
        .run(itemId, itemType);
    } catch (e) {
      log.warn('SearchService: removeByType failed', { itemType, itemId, error: String(e) });
    }
  }

  private seedCommands(): void {
    try {
      sqlite.transaction(() => {
        sqlite.prepare(`DELETE FROM search_index WHERE item_type = 'command'`).run();
        const stmt = sqlite.prepare(
          `INSERT INTO search_index (item_type, item_id, project_id, task_id, title, keywords)
           VALUES ('command', ?, NULL, NULL, ?, ?)`
        );
        for (const def of ALL_COMMAND_DEFS) {
          stmt.run(def.id, def.label, def.description ?? '');
        }
      })();
      log.info('SearchService: seeded commands', { count: ALL_COMMAND_DEFS.length });
    } catch (e) {
      log.warn('SearchService: seedCommands failed', { error: String(e) });
    }
  }

  private backfill(): void {
    try {
      const count = (
        sqlite.prepare(`SELECT count(*) as n FROM search_index`).get() as { n: number }
      ).n;

      if (count > 0) return;

      const allTasks = db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          name: tasks.name,
          archivedAt: tasks.archivedAt,
          branchName: workspaces.branchName,
        })
        .from(tasks)
        .leftJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
        .all();
      const allProjects = db.select().from(projects).all();
      const allConversations = db.select().from(conversations).all();

      const upsertStmt = sqlite.prepare(
        `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, title, keywords)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      sqlite.transaction(() => {
        for (const t of allTasks) {
          if (t.archivedAt) continue;
          upsertStmt.run('task', t.id, t.projectId, null, t.name, t.branchName ?? '');
        }
        for (const p of allProjects) {
          upsertStmt.run('project', p.id, null, null, p.name, p.path);
        }
        for (const c of allConversations) {
          upsertStmt.run('conversation', c.id, c.projectId, c.taskId, c.title, '');
        }
      })();

      log.info('SearchService: backfilled search index', {
        tasks: allTasks.filter((t) => !t.archivedAt).length,
        projects: allProjects.length,
        conversations: allConversations.length,
      });
    } catch (e) {
      log.warn('SearchService: backfill failed', { error: String(e) });
    }
  }
}

export const searchService = new SearchService();
