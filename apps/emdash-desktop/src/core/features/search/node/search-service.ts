import { isRuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import {
  createLiveJobReplica,
  LiveJobFailedError,
  type JobError,
  type JobInput,
  type JobProgress,
  type JobResult,
  type LiveJobContext,
} from '@emdash/wire';
import type Database from 'better-sqlite3';
import { and, eq, isNull } from 'drizzle-orm';
import { PALETTE_CATALOG } from '@core/manifests/shared/palette-catalog';
import type { Conversation } from '@core/primitives/conversations/api';
import type { Project } from '@core/primitives/projects/api';
import type {
  CommandPaletteQuery,
  SearchItem,
  SearchItemKind,
  WorkspaceFileHit,
} from '@core/primitives/search/api';
import type { Task } from '@core/primitives/tasks/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations, projects, tasks, workspaces } from '@core/services/app-db/node/schema';
import type { WorkspaceRuntimeAccess } from '@core/services/workspace-runtime-access/node';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { searchFileSearchRoot } from '@main/core/file-search/runtime-client';
import { projectEvents } from '@main/core/projects/project-events';
import { taskService } from '@main/core/tasks/task-service';
import { log } from '@main/lib/logger';
import { contentSearchRuntimeContract, type searchContract } from '../api';

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

export type SearchServiceDeps = {
  db: AppDb;
  sqlite: Database.Database;
  acquireWorkspaceRuntime(workspaceId: string): Promise<WorkspaceRuntimeAccess | null>;
};

export class SearchService {
  constructor(private readonly deps: SearchServiceDeps) {}

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

  async searchFiles(
    workspaceId: string,
    query: string,
    limit?: number
  ): Promise<WorkspaceFileHit[]> {
    const workspace = await this.deps.acquireWorkspaceRuntime(workspaceId);
    if (!workspace) return [];
    try {
      return await searchFileSearchRoot(
        workspace.client.fileSearch,
        workspace.files.root,
        query,
        limit
      );
    } finally {
      await workspace.release();
    }
  }

  async searchContent(
    input: JobInput<typeof searchContract.searchWorkspaceContent>,
    context: LiveJobContext<JobProgress<typeof searchContract.searchWorkspaceContent>>
  ): Promise<
    Result<
      JobResult<typeof searchContract.searchWorkspaceContent>,
      JobError<typeof searchContract.searchWorkspaceContent>
    >
  > {
    let workspace: WorkspaceRuntimeAccess | null;
    try {
      workspace = await this.deps.acquireWorkspaceRuntime(input.workspaceId);
    } catch (error) {
      if (isRuntimeResolveError(error)) return err(error);
      throw error;
    }
    if (!workspace) {
      return err({
        type: 'workspace-not-found',
        workspaceId: input.workspaceId,
        message: `Workspace was not found: ${input.workspaceId}`,
      });
    }

    const jobs = createLiveJobReplica(
      contentSearchRuntimeContract.searchContent,
      workspace.client.fileSearch.searchContent
    );
    const { workspaceId: _, ...searchInput } = input;
    try {
      const lease = await jobs.start({ ...searchInput, root: workspace.files.root });
      try {
        const job = await lease.ready();
        const unsubscribe = job.onProgress(context.progress);
        const cancel = () => void job.cancel();
        context.signal.addEventListener('abort', cancel, { once: true });
        if (context.signal.aborted) cancel();
        try {
          return ok(await job.result);
        } catch (error) {
          if (error instanceof LiveJobFailedError) return err(error.error);
          throw error;
        } finally {
          context.signal.removeEventListener('abort', cancel);
          unsubscribe();
        }
      } finally {
        await lease.release();
      }
    } finally {
      await jobs.dispose();
      await workspace.release();
    }
  }

  async search({ query, context }: CommandPaletteQuery): Promise<SearchItem[]> {
    if (!query.trim()) return this.recents(context);

    // Trigram tokenizer requires each term to be at least 3 characters.
    // Terms shorter than 3 chars are dropped; if nothing survives, fall back
    // to recents rather than sending an invalid query to SQLite.
    const terms = query
      .trim()
      .split(/[\s\-_]+/)
      .filter((t) => t.length >= 3);

    if (terms.length === 0) return this.recents(context);

    const fileHitsPromise = context?.workspaceId
      ? this.searchFiles(context.workspaceId, query)
      : Promise.resolve([]);
    const ftsQuery = terms.map((t) => `"${t}"`).join(' AND ');

    let rows: FtsRow[] = [];
    try {
      if (context?.taskId) {
        rows = this.deps.sqlite
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
        rows = this.deps.sqlite
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

    const fileHits = await fileHitsPromise;
    for (const hit of fileHits) {
      results.push({
        kind: 'file',
        id: hit.path,
        projectId: context?.projectId ?? null,
        taskId: context?.taskId ?? null,
        title: hit.filename,
        subtitle: hit.path,
        score: 0,
      });
    }

    return results;
  }

  private recents(context?: CommandPaletteQuery['context']): SearchItem[] {
    const taskStmt = context?.projectId
      ? this.deps.sqlite.prepare(
          `SELECT t.id, t.name, t.project_id
           FROM tasks t
           WHERE t.archived_at IS NULL AND t.deleted_at IS NULL AND t.project_id = ?
           ORDER BY t.last_interacted_at DESC
           LIMIT 10`
        )
      : this.deps.sqlite.prepare(
          `SELECT t.id, t.name, t.project_id
           FROM tasks t
           WHERE t.archived_at IS NULL AND t.deleted_at IS NULL
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
      const conversationRows = this.deps.sqlite
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
      const [ws] = await this.deps.db
        .select({ branchName: workspaces.branchName })
        .from(workspaces)
        .where(and(eq(workspaces.id, task.workspaceId), isNull(workspaces.deletedAt)))
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
      this.deps.sqlite
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
      this.deps.sqlite
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
      this.deps.sqlite
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
      this.deps.sqlite
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
      this.deps.sqlite
        .prepare(`DELETE FROM search_index WHERE item_id = ? AND item_type = ?`)
        .run(itemId, itemType);
    } catch (e) {
      log.warn('SearchService: removeByType failed', { itemType, itemId, error: String(e) });
    }
  }

  private seedCommands(): void {
    try {
      this.deps.sqlite.transaction(() => {
        this.deps.sqlite.prepare(`DELETE FROM search_index WHERE item_type = 'command'`).run();
        const stmt = this.deps.sqlite.prepare(
          `INSERT INTO search_index (item_type, item_id, project_id, task_id, title, keywords)
           VALUES ('command', ?, NULL, NULL, ?, ?)`
        );
        for (const item of PALETTE_CATALOG.items) {
          const { command } = item;
          const keywords = [
            command.description,
            ...new Set([...command.keywords, ...(item.keywords ?? [])]),
          ]
            .filter(Boolean)
            .join(' ');
          stmt.run(command.id, command.title, keywords);
        }
      })();
      log.info('SearchService: seeded commands', { count: PALETTE_CATALOG.items.length });
    } catch (e) {
      log.warn('SearchService: seedCommands failed', { error: String(e) });
    }
  }

  private backfill(): void {
    try {
      const count = (
        this.deps.sqlite.prepare(`SELECT count(*) as n FROM search_index`).get() as { n: number }
      ).n;

      if (count > 0) return;

      const allTasks = this.deps.db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          name: tasks.name,
          archivedAt: tasks.archivedAt,
          branchName: workspaces.branchName,
        })
        .from(tasks)
        .leftJoin(
          workspaces,
          and(eq(tasks.workspaceId, workspaces.id), isNull(workspaces.deletedAt))
        )
        .where(isNull(tasks.deletedAt))
        .all();
      const allProjects = this.deps.db
        .select()
        .from(projects)
        .where(isNull(projects.deletedAt))
        .all();
      const allConversations = this.deps.db.select().from(conversations).all();

      const upsertStmt = this.deps.sqlite.prepare(
        `INSERT OR REPLACE INTO search_index(item_type, item_id, project_id, task_id, title, keywords)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      this.deps.sqlite.transaction(() => {
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

export function createSearchService(deps: SearchServiceDeps): SearchService {
  return new SearchService(deps);
}
