import type sqlite3Type from 'sqlite3';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { resolveDatabasePath, resolveMigrationsPath } from '../db/path';
import { getDrizzleClient } from '../db/drizzleClient';
import {
  projects as projectsTable,
  tasks as tasksTable,
  conversations as conversationsTable,
  messages as messagesTable,
  lineComments as lineCommentsTable,
  type ProjectRow,
  type TaskRow,
  type ConversationRow,
  type MessageRow,
  type LineCommentRow,
  type LineCommentInsert,
} from '../db/schema';

export interface Project {
  id: string;
  name: string;
  path: string;
  gitInfo: {
    isGitRepo: boolean;
    remote?: string;
    branch?: string;
    baseRef?: string;
  };
  githubInfo?: {
    repository: string;
    connected: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  agentId?: string | null;
  metadata?: any;
  useWorktree?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  taskId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: string;
  metadata?: string; // JSON string for additional data
}

export interface MigrationSummary {
  appliedCount: number;
  totalMigrations: number;
  recovered: boolean;
}

export class DatabaseService {
  private static migrationsApplied = false;
  private db: sqlite3Type.Database | null = null;
  private sqlite3: typeof sqlite3Type | null = null;
  private dbPath: string;
  private disabled: boolean = false;
  private lastMigrationSummary: MigrationSummary | null = null;

  constructor() {
    if (process.env.EMDASH_DISABLE_NATIVE_DB === '1') {
      this.disabled = true;
    }
    this.dbPath = resolveDatabasePath();
  }

  async initialize(): Promise<void> {
    if (this.disabled) return Promise.resolve();
    if (!this.sqlite3) {
      try {
        // Dynamic import to avoid loading native module at startup
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.sqlite3 = (await import('sqlite3')) as unknown as typeof sqlite3Type;
      } catch (e) {
        return Promise.reject(e);
      }
    }
    return new Promise((resolve, reject) => {
      this.db = new this.sqlite3!.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.ensureMigrations()
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  getLastMigrationSummary(): MigrationSummary | null {
    return this.lastMigrationSummary;
  }

  async saveProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    const gitRemote = project.gitInfo.remote ?? null;
    const gitBranch = project.gitInfo.branch ?? null;
    const baseRef = this.computeBaseRef(
      project.gitInfo.baseRef,
      project.gitInfo.remote,
      project.gitInfo.branch
    );
    const githubRepository = project.githubInfo?.repository ?? null;
    const githubConnected = project.githubInfo?.connected ? 1 : 0;

    await db
      .insert(projectsTable)
      .values({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemote,
        gitBranch,
        baseRef: baseRef ?? null,
        githubRepository,
        githubConnected,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: projectsTable.path,
        set: {
          name: project.name,
          gitRemote,
          gitBranch,
          baseRef: baseRef ?? null,
          githubRepository,
          githubConnected,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  }

  async getProjects(): Promise<Project[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();
    const rows = await db.select().from(projectsTable).orderBy(desc(projectsTable.updatedAt));
    return rows.map((row) => this.mapDrizzleProjectRow(row));
  }

  async getProjectById(projectId: string): Promise<Project | null> {
    if (this.disabled) return null;
    if (!projectId) {
      throw new Error('projectId is required');
    }
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return this.mapDrizzleProjectRow(rows[0]);
  }

  async updateProjectBaseRef(projectId: string, nextBaseRef: string): Promise<Project | null> {
    if (this.disabled) return null;
    if (!projectId) {
      throw new Error('projectId is required');
    }
    const trimmed = typeof nextBaseRef === 'string' ? nextBaseRef.trim() : '';
    if (!trimmed) {
      throw new Error('baseRef cannot be empty');
    }

    const { db } = await getDrizzleClient();
    const rows = await db
      .select({
        id: projectsTable.id,
        gitRemote: projectsTable.gitRemote,
        gitBranch: projectsTable.gitBranch,
      })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1);

    if (rows.length === 0) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const source = rows[0];
    const normalized = this.computeBaseRef(trimmed, source.gitRemote, source.gitBranch);

    await db
      .update(projectsTable)
      .set({
        baseRef: normalized,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(projectsTable.id, projectId));

    return this.getProjectById(projectId);
  }

  async saveTask(task: Omit<Task, 'createdAt' | 'updatedAt'>): Promise<void> {
    if (this.disabled) return;
    const metadataValue =
      typeof task.metadata === 'string'
        ? task.metadata
        : task.metadata
          ? JSON.stringify(task.metadata)
          : null;
    const { db } = await getDrizzleClient();
    await db
      .insert(tasksTable)
      .values({
        id: task.id,
        projectId: task.projectId,
        name: task.name,
        branch: task.branch,
        path: task.path,
        status: task.status,
        agentId: task.agentId ?? null,
        metadata: metadataValue,
        useWorktree: task.useWorktree !== false ? 1 : 0,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: tasksTable.id,
        set: {
          projectId: task.projectId,
          name: task.name,
          branch: task.branch,
          path: task.path,
          status: task.status,
          agentId: task.agentId ?? null,
          metadata: metadataValue,
          useWorktree: task.useWorktree !== false ? 1 : 0,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  }

  async getTasks(projectId?: string): Promise<Task[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();

    const rows: TaskRow[] = projectId
      ? await db
          .select()
          .from(tasksTable)
          .where(eq(tasksTable.projectId, projectId))
          .orderBy(desc(tasksTable.updatedAt))
      : await db.select().from(tasksTable).orderBy(desc(tasksTable.updatedAt));
    return rows.map((row) => this.mapDrizzleTaskRow(row));
  }

  async getTaskByPath(taskPath: string): Promise<Task | null> {
    if (this.disabled) return null;
    const { db } = await getDrizzleClient();

    const rows = await db.select().from(tasksTable).where(eq(tasksTable.path, taskPath)).limit(1);

    if (rows.length === 0) return null;
    return this.mapDrizzleTaskRow(rows[0]);
  }

  async deleteProject(projectId: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }

  async deleteTask(taskId: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    await db.delete(tasksTable).where(eq(tasksTable.id, taskId));
  }

  // Conversation management methods
  async saveConversation(
    conversation: Omit<Conversation, 'createdAt' | 'updatedAt'>
  ): Promise<void> {
    const { db } = await getDrizzleClient();
    await db
      .insert(conversationsTable)
      .values({
        id: conversation.id,
        taskId: conversation.taskId,
        title: conversation.title,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: conversationsTable.id,
        set: {
          title: conversation.title,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  }

  async getConversations(taskId: string): Promise<Conversation[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.taskId, taskId))
      .orderBy(desc(conversationsTable.updatedAt));
    return rows.map((row) => this.mapDrizzleConversationRow(row));
  }

  async getOrCreateDefaultConversation(taskId: string): Promise<Conversation> {
    if (this.disabled) {
      return {
        id: `conv-${taskId}-default`,
        taskId,
        title: 'Default Conversation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    const { db } = await getDrizzleClient();

    const existingRows = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.taskId, taskId))
      .orderBy(asc(conversationsTable.createdAt))
      .limit(1);

    if (existingRows.length > 0) {
      return this.mapDrizzleConversationRow(existingRows[0]);
    }

    const conversationId = `conv-${taskId}-${Date.now()}`;
    await this.saveConversation({
      id: conversationId,
      taskId,
      title: 'Default Conversation',
    });

    const [createdRow] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1);

    if (createdRow) {
      return this.mapDrizzleConversationRow(createdRow);
    }

    return {
      id: conversationId,
      taskId,
      title: 'Default Conversation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // Message management methods
  async saveMessage(message: Omit<Message, 'timestamp'>): Promise<void> {
    if (this.disabled) return;
    const metadataValue =
      typeof message.metadata === 'string'
        ? message.metadata
        : message.metadata
          ? JSON.stringify(message.metadata)
          : null;
    const { db } = await getDrizzleClient();
    await db.transaction(async (tx) => {
      await tx
        .insert(messagesTable)
        .values({
          id: message.id,
          conversationId: message.conversationId,
          content: message.content,
          sender: message.sender,
          metadata: metadataValue,
          timestamp: sql`CURRENT_TIMESTAMP`,
        })
        .onConflictDoNothing()
        .run();

      await tx
        .update(conversationsTable)
        .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(conversationsTable.id, message.conversationId))
        .run();
    });
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(asc(messagesTable.timestamp));
    return rows.map((row) => this.mapDrizzleMessageRow(row));
  }

  async deleteConversation(conversationId: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    await db.delete(conversationsTable).where(eq(conversationsTable.id, conversationId));
  }

  // Line comment management methods
  async saveLineComment(
    input: Omit<LineCommentInsert, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<string> {
    if (this.disabled) return '';
    const id = `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { db } = await getDrizzleClient();
    await db.insert(lineCommentsTable).values({
      id,
      taskId: input.taskId,
      filePath: input.filePath,
      lineNumber: input.lineNumber,
      lineContent: input.lineContent ?? null,
      content: input.content,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    });
    return id;
  }

  async getLineComments(taskId: string, filePath?: string): Promise<LineCommentRow[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();

    if (filePath) {
      const rows = await db
        .select()
        .from(lineCommentsTable)
        .where(
          sql`${lineCommentsTable.taskId} = ${taskId} AND ${lineCommentsTable.filePath} = ${filePath}`
        )
        .orderBy(asc(lineCommentsTable.lineNumber));
      return rows;
    }

    const rows = await db
      .select()
      .from(lineCommentsTable)
      .where(eq(lineCommentsTable.taskId, taskId))
      .orderBy(asc(lineCommentsTable.lineNumber));
    return rows;
  }

  async updateLineComment(id: string, content: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    await db
      .update(lineCommentsTable)
      .set({
        content,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(lineCommentsTable.id, id));
  }

  async deleteLineComment(id: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    await db.delete(lineCommentsTable).where(eq(lineCommentsTable.id, id));
  }

  async markCommentsSent(commentIds: string[]): Promise<void> {
    if (this.disabled || commentIds.length === 0) return;
    const { db } = await getDrizzleClient();
    const now = new Date().toISOString();
    await db
      .update(lineCommentsTable)
      .set({ sentAt: now })
      .where(inArray(lineCommentsTable.id, commentIds));
  }

  async getUnsentComments(taskId: string): Promise<LineCommentRow[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(lineCommentsTable)
      .where(and(eq(lineCommentsTable.taskId, taskId), isNull(lineCommentsTable.sentAt)))
      .orderBy(asc(lineCommentsTable.filePath), asc(lineCommentsTable.lineNumber));
    return rows;
  }

  private computeBaseRef(
    preferred?: string | null,
    remote?: string | null,
    branch?: string | null
  ): string {
    const remoteName = this.getRemoteAlias(remote);
    const normalize = (value?: string | null): string | undefined => {
      if (!value) return undefined;
      const trimmed = value.trim();
      if (!trimmed || trimmed.includes('://')) return undefined;

      if (trimmed.includes('/')) {
        const [head, ...rest] = trimmed.split('/');
        const branchPart = rest.join('/').replace(/^\/+/, '');
        if (head && branchPart) {
          return `${head}/${branchPart}`;
        }
        if (!head && branchPart) {
          // Leading slash - prepend remote if available
          return remoteName ? `${remoteName}/${branchPart}` : branchPart;
        }
        return undefined;
      }

      // Plain branch name - prepend remote only if one exists
      const suffix = trimmed.replace(/^\/+/, '');
      return remoteName ? `${remoteName}/${suffix}` : suffix;
    };

    // Default: use origin/main if remote exists, otherwise just 'main'
    const defaultBranch = remoteName
      ? `${remoteName}/${this.defaultBranchName()}`
      : this.defaultBranchName();
    return normalize(preferred) ?? normalize(branch) ?? defaultBranch;
  }

  private defaultRemoteName(): string {
    return 'origin';
  }

  private getRemoteAlias(remote?: string | null): string {
    if (!remote) return this.defaultRemoteName();
    const trimmed = remote.trim();
    if (!trimmed) return ''; // Empty string indicates no remote (local-only repo)
    if (/^[A-Za-z0-9._-]+$/.test(trimmed) && !trimmed.includes('://')) {
      return trimmed;
    }
    return this.defaultRemoteName();
  }

  private defaultBranchName(): string {
    return 'main';
  }

  private mapDrizzleProjectRow(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      gitInfo: {
        isGitRepo: !!(row.gitRemote || row.gitBranch),
        remote: row.gitRemote ?? undefined,
        branch: row.gitBranch ?? undefined,
        baseRef: this.computeBaseRef(row.baseRef, row.gitRemote, row.gitBranch),
      },
      githubInfo: row.githubRepository
        ? {
            repository: row.githubRepository,
            connected: !!row.githubConnected,
          }
        : undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDrizzleTaskRow(row: TaskRow): Task {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      branch: row.branch,
      path: row.path,
      status: (row.status as Task['status']) ?? 'idle',
      agentId: row.agentId ?? null,
      metadata:
        typeof row.metadata === 'string' && row.metadata.length > 0
          ? this.parseTaskMetadata(row.metadata, row.id)
          : null,
      useWorktree: row.useWorktree === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDrizzleConversationRow(row: ConversationRow): Conversation {
    return {
      id: row.id,
      taskId: row.taskId,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDrizzleMessageRow(row: MessageRow): Message {
    return {
      id: row.id,
      conversationId: row.conversationId,
      content: row.content,
      sender: row.sender as Message['sender'],
      timestamp: row.timestamp,
      metadata: row.metadata ?? undefined,
    };
  }

  private parseTaskMetadata(serialized: string, taskId: string): any {
    try {
      return JSON.parse(serialized);
    } catch (error) {
      console.warn(`Failed to parse task metadata for ${taskId}`, error);
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.disabled || !this.db) return;

    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private async ensureMigrations(): Promise<void> {
    if (this.disabled) return;
    if (!this.db) throw new Error('Database not initialized');
    if (DatabaseService.migrationsApplied) return;

    const migrationsPath = resolveMigrationsPath();
    if (!migrationsPath) {
      throw new Error('Drizzle migrations folder not found');
    }

    // We run schema migrations with foreign_keys disabled.
    // Many dev DBs were created with foreign_keys=OFF, so legacy data can contain orphans.
    // Enabling FK enforcement mid-migration can cause schema transitions (table rebuilds) to fail.
    await this.execSql('PRAGMA foreign_keys=OFF;');
    try {
      // IMPORTANT:
      // Drizzle's built-in migrator for sqlite-proxy decides what to run based on the latest
      // `created_at` timestamp in __drizzle_migrations. If a migration is added later but has an
      // earlier timestamp than the latest applied migration, Drizzle will skip it forever.
      //
      // To make migrations robust for dev DBs (and for any DB that may have extra migrations),
      // we apply migrations by missing hash instead of timestamp ordering.
      const migrations = readMigrationFiles({ migrationsFolder: migrationsPath });
      const tagByWhen = await this.tryLoadMigrationTagByWhen(migrationsPath);

      await this.execSql(`
        CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at numeric
        )
      `);

      const appliedRows = await this.allSql<{ hash: string }>(
        `SELECT hash FROM "__drizzle_migrations"`
      );
      const applied = new Set(appliedRows.map((r) => r.hash));

      // Recovery: if a previous run partially applied the workspace->task migration, finish it.
      // Symptom: `tasks` exists, `conversations` still has `workspace_id`, and `__new_conversations` exists.
      let recovered = false;
      if (
        (await this.tableExists('tasks')) &&
        (await this.tableExists('conversations')) &&
        (await this.tableExists('__new_conversations')) &&
        (await this.tableHasColumn('conversations', 'workspace_id')) &&
        !(await this.tableHasColumn('conversations', 'task_id'))
      ) {
        // Populate new conversations table from the old one (FK enforcement is OFF, so orphans won't block)
        await this.execSql(`
          INSERT INTO "__new_conversations"("id", "task_id", "title", "created_at", "updated_at")
          SELECT "id", "workspace_id", "title", "created_at", "updated_at" FROM "conversations"
        `);
        await this.execSql(`DROP TABLE "conversations";`);
        await this.execSql(`ALTER TABLE "__new_conversations" RENAME TO "conversations";`);
        await this.execSql(
          `CREATE INDEX IF NOT EXISTS "idx_conversations_task_id" ON "conversations" ("task_id");`
        );

        // Mark the workspace->task migration as applied (even if it wasn't tracked).
        // This prevents the hash-based runner from attempting to re-run it against a partially-migrated DB.
        await this.ensureMigrationMarkedApplied(
          migrationsPath,
          applied,
          '0002_lyrical_impossible_man'
        );
        recovered = true;
      }

      let appliedCount = 0;
      for (const migration of migrations) {
        if (applied.has(migration.hash)) continue;

        const tag = tagByWhen?.get(migration.folderMillis);
        // If the DB already reflects the workspace->task rename (e.g. user manually fixed their DB)
        // but the migration hash wasn't recorded, mark it as applied and move on.
        if (
          tag === '0002_lyrical_impossible_man' &&
          (await this.tableExists('tasks')) &&
          !(await this.tableExists('workspaces')) &&
          (await this.tableExists('conversations')) &&
          (await this.tableHasColumn('conversations', 'task_id'))
        ) {
          await this.execSql(
            `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES('${migration.hash}', '${migration.folderMillis}')`
          );
          applied.add(migration.hash);
          continue;
        }

        // Execute each statement chunk (drizzle-kit uses '--> statement-breakpoint')
        for (const statement of migration.sql) {
          // We manage FK enforcement ourselves during migrations.
          const trimmed = statement.trim().toUpperCase();
          if (trimmed.startsWith('PRAGMA FOREIGN_KEYS=')) continue;
          await this.execSql(statement);
        }

        // Record as applied (same schema as Drizzle uses)
        await this.execSql(
          `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES('${migration.hash}', '${migration.folderMillis}')`
        );

        applied.add(migration.hash);
        appliedCount += 1;
      }

      this.lastMigrationSummary = {
        appliedCount,
        totalMigrations: migrations.length,
        recovered,
      };

      DatabaseService.migrationsApplied = true;
    } finally {
      // Restore FK enforcement for normal operation (and ensure it's re-enabled on failure).
      await this.execSql('PRAGMA foreign_keys=ON;');
    }
  }

  private async tryLoadMigrationTagByWhen(
    migrationsFolder: string
  ): Promise<Map<number, string> | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('node:fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('node:path');
      const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
      if (!fs.existsSync(journalPath)) return null;
      const parsed: unknown = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return null;
      const entries = (parsed as { entries?: unknown }).entries;
      if (!Array.isArray(entries)) return null;

      const map = new Map<number, string>();
      for (const e of entries) {
        if (!e || typeof e !== 'object') continue;
        const when = (e as { when?: unknown }).when;
        const tag = (e as { tag?: unknown }).tag;
        if (typeof when === 'number' && typeof tag === 'string') {
          map.set(when, tag);
        }
      }
      return map;
    } catch {
      return null;
    }
  }

  private async ensureMigrationMarkedApplied(
    migrationsFolder: string,
    applied: Set<string>,
    tag: string
  ): Promise<void> {
    // Only mark if the SQL file + journal entry exist.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('node:crypto');

    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
    if (!fs.existsSync(journalPath)) return;
    const journalParsed: unknown = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    const entries = (journalParsed as { entries?: unknown }).entries;
    if (!Array.isArray(entries)) return;
    const entry = entries.find((e) => {
      if (!e || typeof e !== 'object') return false;
      return (e as { tag?: unknown }).tag === tag;
    }) as { when?: unknown } | undefined;
    if (!entry) return;

    const sqlPath = path.join(migrationsFolder, `${tag}.sql`);
    if (!fs.existsSync(sqlPath)) return;
    const contents = fs.readFileSync(sqlPath, 'utf8');
    const hash = crypto.createHash('sha256').update(contents).digest('hex');

    if (applied.has(hash)) return;
    const createdAt = typeof entry.when === 'number' ? entry.when : Date.now();
    await this.execSql(
      `INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES('${hash}', '${createdAt}')`
    );
    applied.add(hash);
  }

  private async tableExists(name: string): Promise<boolean> {
    const rows = await this.allSql<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${name.replace(/'/g, "''")}' LIMIT 1`
    );
    return rows.length > 0;
  }

  private async tableHasColumn(tableName: string, columnName: string): Promise<boolean> {
    if (!(await this.tableExists(tableName))) return false;
    const rows = await this.allSql<{ name: string }>(
      `PRAGMA table_info("${tableName.replace(/"/g, '""')}")`
    );
    return rows.some((r) => r.name === columnName);
  }

  private async allSql<T = any>(query: string): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    const trimmed = query.trim();
    if (!trimmed) return [];

    return await new Promise<T[]>((resolve, reject) => {
      this.db!.all(trimmed, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve((rows ?? []) as T[]);
        }
      });
    });
  }

  private async execSql(statement: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const trimmed = statement.trim();
    if (!trimmed) return;

    await new Promise<void>((resolve, reject) => {
      this.db!.exec(trimmed, (err) => {
        if (err) {
          // Handle idempotent migration cases - skip if schema already matches
          const msg = err.message ?? '';
          if (msg.includes('duplicate column name') || msg.includes('already exists')) {
            // Schema change already applied, continue
            resolve();
            return;
          }
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

export const databaseService = new DatabaseService();
