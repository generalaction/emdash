import type BetterSqlite3 from 'better-sqlite3';
import Database from 'better-sqlite3';
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolveDatabasePath, resolveMigrationsPath } from '../db/path';
import { createDrizzleClient, getDrizzleClient, resetDrizzleClient } from '../db/drizzleClient';
import { errorTracking } from '../errorTracking';
import {
  projects as projectsTable,
  tasks as tasksTable,
  conversations as conversationsTable,
  messages as messagesTable,
  lineComments as lineCommentsTable,
  sshConnections as sshConnectionsTable,
  type ProjectRow,
  type TaskRow,
  type ConversationRow,
  type MessageRow,
  type LineCommentRow,
  type LineCommentInsert,
  type SshConnectionRow,
  type SshConnectionInsert,
} from '../db/schema';

export interface Project {
  id: string;
  name: string;
  path: string;
  // Remote project fields (optional for backward compatibility)
  isRemote?: boolean;
  sshConnectionId?: string | null;
  remotePath?: string | null;
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
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  taskId: string;
  title: string;
  provider?: string | null;
  /** @deprecated Active conversation is tracked in localStorage on the renderer side. This field is no longer written or read. */
  isActive?: boolean;
  isMain?: boolean;
  displayOrder?: number;
  metadata?: string | null;
  /** Provider session UUID used for session isolation (e.g. Claude --session-id / --resume). */
  agentSessionId?: string | null;
  /** 'agent' for AI agent conversations, 'shell' for lifecycle/dev-server terminal sessions. */
  type?: 'agent' | 'shell';
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

export class DatabaseSchemaMismatchError extends Error {
  readonly code = 'DB_SCHEMA_MISMATCH';
  readonly dbPath: string;
  readonly missingInvariants: string[];

  constructor(dbPath: string, missingInvariants: string[]) {
    const suffix = missingInvariants.length > 0 ? ` (${missingInvariants.join(', ')})` : '';
    super(`Database schema mismatch${suffix}`);
    this.name = 'DatabaseSchemaMismatchError';
    this.dbPath = dbPath;
    this.missingInvariants = missingInvariants;
  }
}

export class DatabaseService {
  private db: BetterSqlite3.Database | null = null;
  private dbPath: string;
  private disabled: boolean = false;

  constructor() {
    if (process.env.EMDASH_DISABLE_NATIVE_DB === '1') {
      this.disabled = true;
    }
    this.dbPath = resolveDatabasePath();
  }

  async initialize(): Promise<void> {
    if (this.disabled) return;

    const migrationsPath = resolveMigrationsPath();
    if (!migrationsPath) {
      throw new Error(
        [
          'Failed to locate database migrations folder.',
          'This can happen when:',
          '1. The app was installed via Homebrew (try downloading directly from GitHub)',
          '2. The app is running from Downloads/DMG (move it to Applications)',
          '3. The installation is incomplete or corrupted',
          '4. Security software is blocking file access',
          '',
          'To fix: Try downloading and installing Emdash directly from:',
          'https://github.com/generalaction/emdash/releases',
        ].join('\n')
      );
    }

    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');
    } catch (e) {
      await errorTracking.captureDatabaseError(e, 'initialize_connection', {
        db_path: this.dbPath,
      });
      throw e;
    }

    try {
      // Register this connection as the shared Drizzle client so all data
      // access uses the same SQLite handle — no second connection opened.
      const { db } = createDrizzleClient({ database: this.db, cacheResult: true });
      migrate(db, { migrationsFolder: migrationsPath });
      this.validateSchemaContract();
    } catch (initError) {
      const operation =
        initError instanceof DatabaseSchemaMismatchError
          ? 'initialize_schema_contract'
          : 'initialize_migrations';
      await errorTracking.captureDatabaseError(initError, operation, {
        db_path: this.dbPath,
      });
      throw initError;
    }
  }

  getLastMigrationSummary(): null {
    return null;
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

    // Clean up stale rows that would conflict on id or path but not both.
    // This prevents unique constraint errors when re-adding a deleted project.
    await db
      .delete(projectsTable)
      .where(
        or(
          and(eq(projectsTable.id, project.id), ne(projectsTable.path, project.path)),
          and(eq(projectsTable.path, project.path), ne(projectsTable.id, project.id))
        )
      );

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
        sshConnectionId: project.sshConnectionId ?? null,
        isRemote: project.isRemote ? 1 : 0,
        remotePath: project.remotePath ?? null,
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
          sshConnectionId: project.sshConnectionId ?? null,
          isRemote: project.isRemote ? 1 : 0,
          remotePath: project.remotePath ?? null,
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

    // Filter out archived tasks by default
    const rows: TaskRow[] = projectId
      ? await db
          .select()
          .from(tasksTable)
          .where(and(eq(tasksTable.projectId, projectId), isNull(tasksTable.archivedAt)))
          .orderBy(desc(tasksTable.updatedAt))
      : await db
          .select()
          .from(tasksTable)
          .where(isNull(tasksTable.archivedAt))
          .orderBy(desc(tasksTable.updatedAt));
    return rows.map((row) => this.mapDrizzleTaskRow(row));
  }

  async getArchivedTasks(projectId?: string): Promise<Task[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();

    const rows: TaskRow[] = projectId
      ? await db
          .select()
          .from(tasksTable)
          .where(
            and(eq(tasksTable.projectId, projectId), sql`${tasksTable.archivedAt} IS NOT NULL`)
          )
          .orderBy(desc(tasksTable.archivedAt))
      : await db
          .select()
          .from(tasksTable)
          .where(sql`${tasksTable.archivedAt} IS NOT NULL`)
          .orderBy(desc(tasksTable.archivedAt));
    return rows.map((row) => this.mapDrizzleTaskRow(row));
  }

  async archiveTask(taskId: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    await db
      .update(tasksTable)
      .set({
        archivedAt: new Date().toISOString(),
        status: 'idle', // Reset status since PTY processes are killed on archive
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(tasksTable.id, taskId));
  }

  async restoreTask(taskId: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    await db
      .update(tasksTable)
      .set({
        archivedAt: null,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(tasksTable.id, taskId));
  }

  async getTaskByPath(taskPath: string): Promise<Task | null> {
    if (this.disabled) return null;
    const { db } = await getDrizzleClient();

    const rows = await db.select().from(tasksTable).where(eq(tasksTable.path, taskPath)).limit(1);

    if (rows.length === 0) return null;
    return this.mapDrizzleTaskRow(rows[0]);
  }

  async getTaskById(taskId: string): Promise<Task | null> {
    if (this.disabled) return null;
    if (!taskId) return null;
    const { db } = await getDrizzleClient();
    const rows = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId)).limit(1);
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
        provider: conversation.provider ?? null,
        isActive: conversation.isActive ? 1 : 0,
        isMain: conversation.isMain ? 1 : 0,
        displayOrder: conversation.displayOrder ?? 0,
        metadata: conversation.metadata ?? null,
        agentSessionId: conversation.agentSessionId ?? null,
        type: conversation.type ?? 'agent',
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: conversationsTable.id,
        set: {
          title: conversation.title,
          provider: conversation.provider ?? null,
          isActive: conversation.isActive ? 1 : 0,
          isMain: conversation.isMain ? 1 : 0,
          displayOrder: conversation.displayOrder ?? 0,
          metadata: conversation.metadata ?? null,
          agentSessionId: conversation.agentSessionId ?? null,
          type: conversation.type ?? 'agent',
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
      .orderBy(asc(conversationsTable.displayOrder), desc(conversationsTable.updatedAt));
    return rows.map((row) => this.mapDrizzleConversationRow(row));
  }

  async getOrCreateDefaultConversation(taskId: string): Promise<Conversation> {
    if (this.disabled) {
      return {
        id: `conv-${taskId}-default`,
        taskId,
        title: 'Default Conversation',
        isMain: true,
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
      isMain: true,
      isActive: true,
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

  // New multi-chat methods
  async createConversation(
    taskId: string,
    title: string,
    provider?: string,
    isMain?: boolean,
    opts?: { type?: 'agent' | 'shell' }
  ): Promise<Conversation> {
    if (this.disabled) {
      return {
        id: `conv-${taskId}-${Date.now()}`,
        taskId,
        title,
        provider: provider ?? null,
        isActive: true,
        isMain: isMain ?? false,
        displayOrder: 0,
        metadata: null,
        type: opts?.type ?? 'agent',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const { db } = await getDrizzleClient();

    // Get the next display order
    const existingConversations = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.taskId, taskId));

    const maxOrder = Math.max(...existingConversations.map((c) => c.displayOrder || 0), -1);

    // Check if this should be the main conversation
    // If explicitly set as main, check if one already exists
    if (isMain === true) {
      const hasMain = existingConversations.some((c) => c.isMain === 1);
      if (hasMain) {
        isMain = false; // Don't allow multiple main conversations
      }
    } else if (isMain === undefined) {
      // If not specified, make it main only if it's the first conversation
      isMain = existingConversations.length === 0;
    }

    // @deprecated isActive deactivation — active tab is now tracked in localStorage on the renderer side
    await db
      .update(conversationsTable)
      .set({ isActive: 0 })
      .where(eq(conversationsTable.taskId, taskId));

    // Create the new conversation
    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newConversation = {
      id: conversationId,
      taskId,
      title,
      provider: provider ?? null,
      isActive: true,
      isMain: isMain ?? false,
      displayOrder: maxOrder + 1,
      type: opts?.type ?? 'agent',
    };

    await this.saveConversation(newConversation);

    // Fetch the created conversation
    const [createdRow] = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1);

    return this.mapDrizzleConversationRow(createdRow);
  }

  /** @deprecated Active conversation is tracked in localStorage on the renderer side. This method is no longer called. */
  async setActiveConversation(taskId: string, conversationId: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();

    await db.transaction(async (tx) => {
      // Deactivate all conversations for this task
      await tx
        .update(conversationsTable)
        .set({ isActive: 0 })
        .where(eq(conversationsTable.taskId, taskId));

      // Activate the selected one
      await tx
        .update(conversationsTable)
        .set({ isActive: 1, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(conversationsTable.id, conversationId));
    });
  }

  /** @deprecated Active conversation is tracked in localStorage on the renderer side. This method is no longer called. */
  async getActiveConversation(taskId: string): Promise<Conversation | null> {
    if (this.disabled) return null;
    const { db } = await getDrizzleClient();

    const results = await db
      .select()
      .from(conversationsTable)
      .where(and(eq(conversationsTable.taskId, taskId), eq(conversationsTable.isActive, 1)))
      .limit(1);

    return results[0] ? this.mapDrizzleConversationRow(results[0]) : null;
  }

  async reorderConversations(taskId: string, conversationIds: string[]): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();

    await db.transaction(async (tx) => {
      for (let i = 0; i < conversationIds.length; i++) {
        await tx
          .update(conversationsTable)
          .set({ displayOrder: i })
          .where(eq(conversationsTable.id, conversationIds[i]));
      }
    });
  }

  async updateConversationTitle(conversationId: string, title: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();

    await db
      .update(conversationsTable)
      .set({ title, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(conversationsTable.id, conversationId));
  }

  async getConversationById(conversationId: string): Promise<Conversation | null> {
    if (this.disabled) return null;
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.id, conversationId))
      .limit(1);
    return rows[0] ? this.mapDrizzleConversationRow(rows[0]) : null;
  }

  async updateConversationSessionId(conversationId: string, agentSessionId: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    await db
      .update(conversationsTable)
      .set({ agentSessionId, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(conversationsTable.id, conversationId));
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

  // SSH connection management methods
  async saveSshConnection(
    connection: Omit<SshConnectionInsert, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }
  ): Promise<SshConnectionRow> {
    if (this.disabled) {
      throw new Error('Database is disabled');
    }
    const { db } = await getDrizzleClient();

    const id = connection.id ?? `ssh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    const result = await db
      .insert(sshConnectionsTable)
      .values({
        ...connection,
        id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sshConnectionsTable.id,
        set: {
          name: connection.name,
          host: connection.host,
          port: connection.port,
          username: connection.username,
          authType: connection.authType,
          privateKeyPath: connection.privateKeyPath ?? null,
          useAgent: connection.useAgent,
          updatedAt: now,
        },
      })
      .returning();

    return result[0];
  }

  async getSshConnections(): Promise<SshConnectionRow[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();
    return db.select().from(sshConnectionsTable).orderBy(sshConnectionsTable.name);
  }

  async getSshConnection(id: string): Promise<SshConnectionRow | null> {
    if (this.disabled) return null;
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(sshConnectionsTable)
      .where(eq(sshConnectionsTable.id, id))
      .limit(1);
    return rows.length > 0 ? rows[0] : null;
  }

  async deleteSshConnection(id: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();

    // First update any projects using this connection
    await db
      .update(projectsTable)
      .set({ sshConnectionId: null, isRemote: 0 })
      .where(eq(projectsTable.sshConnectionId, id));

    // Then delete the connection
    await db.delete(sshConnectionsTable).where(eq(sshConnectionsTable.id, id));
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
      isRemote: row.isRemote === 1,
      sshConnectionId: row.sshConnectionId ?? null,
      remotePath: row.remotePath ?? null,
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
      archivedAt: row.archivedAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDrizzleConversationRow(row: ConversationRow): Conversation {
    return {
      id: row.id,
      taskId: row.taskId,
      title: row.title,
      provider: row.provider ?? null,
      isActive: row.isActive === 1,
      // For backward compatibility: treat missing isMain as true (assume first/only conversation is main)
      isMain: row.isMain !== undefined ? row.isMain === 1 : true,
      displayOrder: row.displayOrder ?? 0,
      metadata: row.metadata ?? null,
      agentSessionId: row.agentSessionId ?? null,
      type: (row.type as 'agent' | 'shell') ?? 'agent',
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

  close(): void {
    if (this.disabled || !this.db) return;
    resetDrizzleClient();
    this.db.close();
    this.db = null;
  }

  private validateSchemaContract(): void {
    if (this.disabled) return;

    const missingInvariants: string[] = [];

    if (!this.tableHasColumn('projects', 'base_ref')) {
      missingInvariants.push('projects.base_ref');
    }
    if (!this.tableExists('tasks')) {
      missingInvariants.push('tasks table');
    }
    if (!this.tableHasColumn('conversations', 'task_id')) {
      missingInvariants.push('conversations.task_id');
    }

    if (missingInvariants.length > 0) {
      throw new DatabaseSchemaMismatchError(this.dbPath, missingInvariants);
    }
  }

  private tableExists(name: string): boolean {
    const rows = this.allSql<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${name.replace(/'/g, "''")}' LIMIT 1`
    );
    return rows.length > 0;
  }

  private tableHasColumn(tableName: string, columnName: string): boolean {
    if (!this.tableExists(tableName)) return false;
    const rows = this.allSql<{ name: string }>(
      `PRAGMA table_info("${tableName.replace(/"/g, '""')}")`
    );
    return rows.some((r) => r.name === columnName);
  }

  private allSql<T = any>(query: string): T[] {
    if (!this.db) throw new Error('Database not initialized');
    const trimmed = query.trim();
    if (!trimmed) return [];
    return this.db.prepare(trimmed).all() as T[];
  }
}

export const databaseService = new DatabaseService();
