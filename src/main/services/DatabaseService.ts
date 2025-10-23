import type sqlite3Type from 'sqlite3';
import { promisify } from 'util';
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

        const finalize = async () => {
          const migrationsApplied = await this.ensureMigrations();
          if (!migrationsApplied) {
            await this.createTables();
          }
        };

        finalize()
          .then(() => resolve())
          .catch(reject);
      });
    });
  }

  private async createTables(): Promise<void> {
    if (this.disabled) return;
    if (!this.db) throw new Error('Database not initialized');

    const runAsync = promisify(this.db.run.bind(this.db));

    // Create projects table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        git_remote TEXT,
        git_branch TEXT,
        github_repository TEXT,
        github_connected BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create workspaces table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        branch TEXT NOT NULL,
        path TEXT NOT NULL,
        status TEXT DEFAULT 'idle',
        agent_id TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
      )
    `);

    try {
      await runAsync(`ALTER TABLE workspaces ADD COLUMN metadata TEXT`);
    } catch (error) {
      if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) {
        throw error;
      }
    }

    // Create conversations table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE
      )
    `);

    // Create messages table
    await runAsync(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        content TEXT NOT NULL,
        sender TEXT NOT NULL CHECK (sender IN ('user', 'agent')),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    await runAsync(`CREATE INDEX IF NOT EXISTS idx_projects_path ON projects (path)`);
    await runAsync(
      `CREATE INDEX IF NOT EXISTS idx_workspaces_project_id ON workspaces (project_id)`
    );
    await runAsync(
      `CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id ON conversations (workspace_id)`
    );
    await runAsync(
      `CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages (conversation_id)`
    );
    await runAsync(`CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp)`);
  }

  async saveProject(project: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<void> {
    if (this.disabled) return;
    const sqliteDb = this.db;
    if (!sqliteDb) throw new Error('Database not initialized');

    const legacySave = () =>
      new Promise<void>((resolve, reject) => {
        sqliteDb.run(
          `INSERT INTO projects (id, name, path, git_remote, git_branch, github_repository, github_connected, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(path) DO UPDATE SET
             name = excluded.name,
             git_remote = excluded.git_remote,
             git_branch = excluded.git_branch,
             github_repository = excluded.github_repository,
             github_connected = excluded.github_connected,
             updated_at = CURRENT_TIMESTAMP
          `,
          [
            project.id,
            project.name,
            project.path,
            project.gitInfo.remote || null,
            project.gitInfo.branch || null,
            project.githubInfo?.repository || null,
            project.githubInfo?.connected ? 1 : 0,
          ],
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          },
        );
      });

    const useDrizzle = featureFlags.useDrizzleWrites();
    if (!useDrizzle) {
      return legacySave();
    }

    try {
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
    } catch (err) {
      this.logDrizzle('saveProject', 'drizzle write failed, falling back to legacy', err);
      if (featureFlags.drizzleDiffAssertions()) {
        throw err;
      }
      await legacySave();
    }
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
    const sqliteDb = this.db;
    if (!sqliteDb) throw new Error('Database not initialized');

    const metadataValue =
      typeof workspace.metadata === 'string'
        ? workspace.metadata
        : workspace.metadata
            ? JSON.stringify(workspace.metadata)
            : null;

    const legacySave = () =>
      new Promise<void>((resolve, reject) => {
        sqliteDb.run(
          `
          INSERT OR REPLACE INTO workspaces 
          (id, project_id, name, branch, path, status, agent_id, metadata, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
          [
            workspace.id,
            workspace.projectId,
            workspace.name,
            workspace.branch,
            workspace.path,
            workspace.status,
            workspace.agentId || null,
            metadataValue,
          ],
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          },
        );
      });

    const useDrizzle = featureFlags.useDrizzleWrites();
    if (!useDrizzle) {
      return legacySave();
    }

    try {
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
    } catch (err) {
      this.logDrizzle('saveWorkspace', 'drizzle write failed, falling back to legacy', err);
      if (featureFlags.drizzleDiffAssertions()) {
        throw err;
      }
      await legacySave();
    }
  }

  async getWorkspaces(projectId?: string): Promise<Workspace[]> {
    if (this.disabled) return [];
    const { db } = await getDrizzleClient();

    let query = db.select().from(workspacesTable);
    if (projectId) {
      query = query.where(eq(workspacesTable.projectId, projectId));
    }

    const rows = await query.orderBy(desc(workspacesTable.updatedAt));
    return rows.map((row) => this.mapDrizzleWorkspaceRow(row));
  }

  async deleteProject(projectId: string): Promise<void> {
    if (this.disabled) return;
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.run('DELETE FROM projects WHERE id = ?', [projectId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    if (this.disabled) return;
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.run('DELETE FROM workspaces WHERE id = ?', [workspaceId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Conversation management methods
  async saveConversation(
    conversation: Omit<Conversation, 'createdAt' | 'updatedAt'>
  ): Promise<void> {
    const sqliteDb = this.db;
    if (!sqliteDb) throw new Error('Database not initialized');

    const legacySave = () =>
      new Promise<void>((resolve, reject) => {
        sqliteDb.run(
          `
          INSERT OR REPLACE INTO conversations 
          (id, workspace_id, title, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `,
          [conversation.id, conversation.workspaceId, conversation.title],
          (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          },
        );
      });

    const useDrizzle = featureFlags.useDrizzleWrites();
    if (!useDrizzle) {
      return legacySave();
    }

    try {
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
    } catch (err) {
      this.logDrizzle('saveConversation', 'drizzle write failed, falling back to legacy', err);
      if (featureFlags.drizzleDiffAssertions()) {
        throw err;
      }
      await legacySave();
    }
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
    const sqliteDb = this.db;
    if (!sqliteDb) throw new Error('Database not initialized');

    const metadataValue =
      typeof message.metadata === 'string'
        ? message.metadata
        : message.metadata
            ? JSON.stringify(message.metadata)
            : null;

    const legacySave = () =>
      new Promise<void>((resolve, reject) => {
        sqliteDb.run(
          `
          INSERT INTO messages 
          (id, conversation_id, content, sender, metadata, timestamp)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
          [
            message.id,
            message.conversationId,
            message.content,
            message.sender,
            metadataValue,
          ],
          (err) => {
            if (err) {
              reject(err);
              return;
            }

            sqliteDb.run(
              `
              UPDATE conversations 
              SET updated_at = CURRENT_TIMESTAMP 
              WHERE id = ?
            `,
              [message.conversationId],
              (updateErr) => {
                if (updateErr) {
                  reject(updateErr);
                } else {
                  resolve();
                }
              },
            );
          },
        );
      });

    const useDrizzle = featureFlags.useDrizzleWrites();
    if (!useDrizzle) {
      return legacySave();
    }

    try {
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
    } catch (err) {
      this.logDrizzle('saveMessage', 'drizzle write failed, falling back to legacy', err);
      if (featureFlags.drizzleDiffAssertions()) {
        throw err;
      }
      await legacySave();
    }
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
    const sqliteDb = this.db;
    if (!sqliteDb) throw new Error('Database not initialized');

    const legacyDelete = () =>
      new Promise<void>((resolve, reject) => {
        sqliteDb.run('DELETE FROM conversations WHERE id = ?', [conversationId], (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

    const useDrizzle = featureFlags.useDrizzleWrites();
    if (!useDrizzle) {
      return legacyDelete();
    }

    try {
      const { db } = await getDrizzleClient();
      await db.delete(conversationsTable).where(eq(conversationsTable.id, conversationId));
    } catch (err) {
      this.logDrizzle('deleteConversation', 'drizzle delete failed, falling back to legacy', err);
      if (featureFlags.drizzleDiffAssertions()) {
        throw err;
      }
      await legacyDelete();
    }
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
      status: row.status,
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
}

export const databaseService = new DatabaseService();
