import type sqlite3Type from 'sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator';
import { resolveDatabasePath, resolveMigrationsPath } from '../db/path';
import { featureFlags } from '../config/featureFlags';
import { getDrizzleClient } from '../db/drizzleClient';
import {
  projects as projectsTable,
  workspaces as workspacesTable,
  conversations as conversationsTable,
  messages as messagesTable,
  type ProjectRow,
  type WorkspaceRow,
  type ConversationRow,
  type MessageRow,
} from '../db/schema';

export interface Project {
  id: string;
  name: string;
  path: string;
  gitInfo: {
    isGitRepo: boolean;
    remote?: string;
    branch?: string;
  };
  githubInfo?: {
    repository: string;
    connected: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Workspace {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  agentId?: string | null;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
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

export class DatabaseService {
  private static migrationsApplied = false;
  private db: sqlite3Type.Database | null = null;
  private sqlite3: typeof sqlite3Type | null = null;
  private dbPath: string;
  private disabled: boolean = false;

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

  async saveProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    const gitRemote = project.gitInfo.remote ?? null;
    const gitBranch = project.gitInfo.branch ?? null;
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
          githubRepository,
          githubConnected,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  }

  async getProjects(): Promise<Project[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(projectsTable)
      .orderBy(desc(projectsTable.updatedAt));
    return rows.map((row) => this.mapDrizzleProjectRow(row));
  }

  async saveWorkspace(workspace: Omit<Workspace, 'createdAt' | 'updatedAt'>): Promise<void> {
    if (this.disabled) return;
    const metadataValue =
      typeof workspace.metadata === 'string'
        ? workspace.metadata
        : workspace.metadata
            ? JSON.stringify(workspace.metadata)
            : null;
    const { db } = await getDrizzleClient();
    await db
      .insert(workspacesTable)
      .values({
        id: workspace.id,
        projectId: workspace.projectId,
        name: workspace.name,
        branch: workspace.branch,
        path: workspace.path,
        status: workspace.status,
        agentId: workspace.agentId ?? null,
        metadata: metadataValue,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .onConflictDoUpdate({
        target: workspacesTable.id,
        set: {
          projectId: workspace.projectId,
          name: workspace.name,
          branch: workspace.branch,
          path: workspace.path,
          status: workspace.status,
          agentId: workspace.agentId ?? null,
          metadata: metadataValue,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  }

  async getWorkspaces(projectId?: string): Promise<Workspace[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();

    const rows: WorkspaceRow[] = projectId
      ? await db
          .select()
          .from(workspacesTable)
          .where(eq(workspacesTable.projectId, projectId))
          .orderBy(desc(workspacesTable.updatedAt))
      : await db.select().from(workspacesTable).orderBy(desc(workspacesTable.updatedAt));
    return rows.map((row) => this.mapDrizzleWorkspaceRow(row));
  }

  async deleteProject(projectId: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    await db.delete(projectsTable).where(eq(projectsTable.id, projectId));
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    if (this.disabled) return;
    const { db } = await getDrizzleClient();
    await db.delete(workspacesTable).where(eq(workspacesTable.id, workspaceId));
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
        workspaceId: conversation.workspaceId,
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

  async getConversations(workspaceId: string): Promise<Conversation[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.workspaceId, workspaceId))
      .orderBy(desc(conversationsTable.updatedAt));
    return rows.map((row) => this.mapDrizzleConversationRow(row));
  }

  async getOrCreateDefaultConversation(workspaceId: string): Promise<Conversation> {
    if (this.disabled) {
      return {
        id: `conv-${workspaceId}-default`,
        workspaceId,
        title: 'Default Conversation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    const { db } = await getDrizzleClient();

    const existingRows = await db
      .select()
      .from(conversationsTable)
      .where(eq(conversationsTable.workspaceId, workspaceId))
      .orderBy(asc(conversationsTable.createdAt))
      .limit(1);

    if (existingRows.length > 0) {
      return this.mapDrizzleConversationRow(existingRows[0]);
    }

    const conversationId = `conv-${workspaceId}-${Date.now()}`;
    await this.saveConversation({
      id: conversationId,
      workspaceId,
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
      workspaceId,
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

  private mapDrizzleProjectRow(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      gitInfo: {
        isGitRepo: !!(row.gitRemote || row.gitBranch),
        remote: row.gitRemote ?? undefined,
        branch: row.gitBranch ?? undefined,
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

  private mapDrizzleWorkspaceRow(row: WorkspaceRow): Workspace {
    return {
      id: row.id,
      projectId: row.projectId,
      name: row.name,
      branch: row.branch,
      path: row.path,
      status: (row.status as Workspace['status']) ?? 'idle',
      agentId: row.agentId ?? null,
      metadata:
        typeof row.metadata === 'string' && row.metadata.length > 0
          ? this.parseWorkspaceMetadata(row.metadata, row.id)
          : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDrizzleConversationRow(row: ConversationRow): Conversation {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
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

  private parseWorkspaceMetadata(serialized: string, workspaceId: string): any {
    try {
      return JSON.parse(serialized);
    } catch (error) {
      console.warn(`Failed to parse workspace metadata for ${workspaceId}`, error);
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

  private getDrizzleLogPrefix(): string {
    const ns = featureFlags.drizzleLogNamespace();
    return ns ? `[${ns}]` : '[drizzle]';
  }

  private logDrizzle(context: string, message: string, payload: unknown): void {
    const prefix = this.getDrizzleLogPrefix();
    console.warn(`${prefix} ${context}: ${message}`, payload);
  }

  private async ensureMigrations(): Promise<void> {
    if (this.disabled) return;
    if (!this.db) throw new Error('Database not initialized');
    if (DatabaseService.migrationsApplied) return;

    const migrationsPath = resolveMigrationsPath();
    if (!migrationsPath) {
      throw new Error('Drizzle migrations folder not found');
    }

    try {
      const { db } = await getDrizzleClient();
      await this.seedMigrationsMetadata(migrationsPath);
      await migrate(
        db,
        async (queries) => {
          for (const statement of queries) {
            await this.execSql(statement);
          }
        },
        {
          migrationsFolder: migrationsPath,
        },
      );

      DatabaseService.migrationsApplied = true;
    } catch (error) {
      this.logDrizzle('migrate', 'failed to apply migrations', error);
      throw error;
    }
  }

  private async seedMigrationsMetadata(migrationsPath: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const hasTable = await this.tableExists('__drizzle_migrations');
    if (hasTable) return;

    const baselineTables = ['projects', 'workspaces', 'conversations', 'messages'];
    const present = await Promise.all(baselineTables.map((table) => this.tableExists(table)));
    if (present.some((exists) => !exists)) {
      return;
    }

    await this.execSql(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      )
    `);

    try {
      const journalPath = join(migrationsPath, 'meta', '_journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      for (const entry of journal.entries ?? []) {
        const sqlPath = join(migrationsPath, `${entry.tag}.sql`);
        const sqlContent = readFileSync(sqlPath, 'utf8');
        const hash = createHash('sha256').update(sqlContent).digest('hex');
        await this.runSql(
          'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)',
          [hash, entry.when],
        );
      }
    } catch (error) {
      this.logDrizzle('migrate', 'failed to seed migration metadata', error);
    }
  }

  private async tableExists(table: string): Promise<boolean> {
    if (!this.db) throw new Error('Database not initialized');

    return new Promise<boolean>((resolve, reject) => {
      this.db!.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        [table],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(!!row);
          }
        },
      );
    });
  }

  private async execSql(statement: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const trimmed = statement.trim();
    if (!trimmed) return;

    await new Promise<void>((resolve, reject) => {
      this.db!.exec(trimmed, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private async runSql(statement: string, params: unknown[] = []): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await new Promise<void>((resolve, reject) => {
      this.db!.run(statement, params, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

export const databaseService = new DatabaseService();
