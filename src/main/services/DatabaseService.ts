import type sqlite3Type from 'sqlite3';
import { isDeepStrictEqual, promisify } from 'util';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { resolveDatabasePath } from '../db/path';
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

        this.createTables()
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
    const sqliteDb = this.db;
    if (!sqliteDb) throw new Error('Database not initialized');

    const fetchLegacy = () =>
      new Promise<Project[]>((resolve, reject) => {
        sqliteDb.all(
          `
          SELECT 
            id, name, path, git_remote, git_branch, github_repository, github_connected,
            created_at, updated_at
          FROM projects 
          ORDER BY updated_at DESC
        `,
          (err, rows: any[]) => {
            if (err) {
              reject(err);
            } else {
              resolve(
                rows.map((row) => ({
                  id: row.id,
                  name: row.name,
                  path: row.path,
                  gitInfo: {
                    isGitRepo: !!(row.git_remote || row.git_branch),
                    remote: row.git_remote,
                    branch: row.git_branch,
                  },
                  githubInfo: row.github_repository
                    ? {
                        repository: row.github_repository,
                        connected: !!row.github_connected,
                      }
                    : undefined,
                  createdAt: row.created_at,
                  updatedAt: row.updated_at,
                })),
              );
            }
          },
        );
      });

    const fetchDrizzle = async () => {
      const { db } = await getDrizzleClient();
      const drizzleRows = await db
        .select()
        .from(projectsTable)
        .orderBy(desc(projectsTable.updatedAt));
      return drizzleRows.map((row) => this.mapDrizzleProjectRow(row));
    };

    const useDrizzle = featureFlags.useDrizzleReads();

    if (!useDrizzle) {
      return fetchLegacy();
    }

    let drizzleProjects: Project[];
    try {
      drizzleProjects = await fetchDrizzle();
    } catch (err) {
      this.logDrizzle('getProjects', 'drizzle primary failed, falling back to legacy', err);
      return fetchLegacy();
    }

    const legacyProjects = await fetchLegacy();
    const matches = await this.compareProjectsWithDrizzle(legacyProjects, drizzleProjects);
    if (!matches) {
      return legacyProjects;
    }

    return drizzleProjects;
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
    const sqliteDb = this.db;
    if (!sqliteDb) throw new Error('Database not initialized');

    const fetchLegacy = () =>
      new Promise<Workspace[]>((resolve, reject) => {
        let query = `
          SELECT 
            id, project_id, name, branch, path, status, agent_id, metadata,
            created_at, updated_at
          FROM workspaces
        `;
        const params: any[] = [];

        if (projectId) {
          query += ' WHERE project_id = ?';
          params.push(projectId);
        }

        query += ' ORDER BY updated_at DESC';

        sqliteDb.all(query, params, (err, rows: any[]) => {
          if (err) {
            reject(err);
          } else {
            resolve(
              rows.map((row) => {
                const metadata =
                  typeof row.metadata === 'string' && row.metadata.length > 0
                    ? this.parseWorkspaceMetadata(row.metadata, row.id)
                    : null;

                return {
                  id: row.id,
                  projectId: row.project_id,
                  name: row.name,
                  branch: row.branch,
                  path: row.path,
                  status: row.status,
                  agentId: row.agent_id,
                  metadata,
                  createdAt: row.created_at,
                  updatedAt: row.updated_at,
                };
              }),
            );
          }
        });
      });

    const fetchDrizzle = async () => {
      const { db } = await getDrizzleClient();
      const query = db.select().from(workspacesTable).orderBy(desc(workspacesTable.updatedAt));
      const drizzleRows = projectId
        ? await query.where(eq(workspacesTable.projectId, projectId))
        : await query;
      return drizzleRows.map((row) => this.mapDrizzleWorkspaceRow(row));
    };

    const useDrizzle = featureFlags.useDrizzleReads();

    if (!useDrizzle) {
      return fetchLegacy();
    }

    let drizzleWorkspaces: Workspace[];
    try {
      drizzleWorkspaces = await fetchDrizzle();
    } catch (err) {
      this.logDrizzle('getWorkspaces', 'drizzle primary failed, falling back to legacy', err);
      return fetchLegacy();
    }

    const legacyWorkspaces = await fetchLegacy();
    const matches = await this.compareWorkspacesWithDrizzle(
      legacyWorkspaces,
      projectId,
      drizzleWorkspaces,
    );
    if (!matches) {
      return legacyWorkspaces;
    }

    return drizzleWorkspaces;
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
    const sqliteDb = this.db;
    if (!sqliteDb) throw new Error('Database not initialized');

    const fetchLegacy = () =>
      new Promise<Conversation[]>((resolve, reject) => {
        sqliteDb.all(
          `
          SELECT * FROM conversations 
          WHERE workspace_id = ? 
          ORDER BY updated_at DESC
        `,
          [workspaceId],
          (err, rows: any[]) => {
            if (err) {
              reject(err);
            } else {
              resolve(
                rows.map((row) => ({
                  id: row.id,
                  workspaceId: row.workspace_id,
                  title: row.title,
                  createdAt: row.created_at,
                  updatedAt: row.updated_at,
                })),
              );
            }
          },
        );
      });

    const fetchDrizzle = async () => {
      const { db } = await getDrizzleClient();
      const drizzleRows = await db
        .select()
        .from(conversationsTable)
        .where(eq(conversationsTable.workspaceId, workspaceId))
        .orderBy(desc(conversationsTable.updatedAt));
      return drizzleRows.map((row) => this.mapDrizzleConversationRow(row));
    };

    const useDrizzle = featureFlags.useDrizzleReads();

    if (!useDrizzle) {
      return fetchLegacy();
    }

    let drizzleConversations: Conversation[];
    try {
      drizzleConversations = await fetchDrizzle();
    } catch (err) {
      this.logDrizzle('getConversations', 'drizzle primary failed, falling back to legacy', err);
      return fetchLegacy();
    }

    const legacyConversations = await fetchLegacy();
    const matches = await this.compareConversationsWithDrizzle(
      legacyConversations,
      workspaceId,
      drizzleConversations,
    );
    if (!matches) {
      return legacyConversations;
    }

    return drizzleConversations;
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
    if (!this.db) throw new Error('Database not initialized');

    const sqliteDb = this.db;
    let createdDefault = false;
    let existing: Conversation | null = null;
    const readResult = await new Promise<Conversation | null>((resolve, reject) => {
      // First, try to get existing conversations
      sqliteDb.all(
        `
        SELECT * FROM conversations 
        WHERE workspace_id = ? 
        ORDER BY created_at ASC
        LIMIT 1
      `,
        [workspaceId],
        (err, rows: any[]) => {
          if (err) {
            reject(err);
            return;
          }

          if (rows.length > 0) {
            // Return existing conversation
            const row = rows[0];
            resolve({
              id: row.id,
              workspaceId: row.workspace_id,
              title: row.title,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            });
          } else {
            // Create new default conversation
            const conversationId = `conv-${workspaceId}-${Date.now()}`;
            sqliteDb.run(
              `
            INSERT INTO conversations 
            (id, workspace_id, title, created_at, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          `,
              [conversationId, workspaceId, 'Default Conversation'],
              (err) => {
                if (err) {
                  reject(err);
                } else {
                  createdDefault = true;
                  resolve({
                    id: conversationId,
                    workspaceId,
                    title: 'Default Conversation',
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  });
                }
              }
            );
          }
        }
      );
    });

    existing = readResult;

    if (!existing) {
      return {
        id: `conv-${workspaceId}-${Date.now()}`,
        workspaceId,
        title: 'Default Conversation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    const useDrizzle = featureFlags.useDrizzleReads();
    if (createdDefault || !useDrizzle) {
      return existing;
    }

    let drizzleConversation: Conversation | null = null;
    try {
      const { db } = await getDrizzleClient();
      const drizzleRows = await db
        .select()
        .from(conversationsTable)
        .where(eq(conversationsTable.workspaceId, workspaceId))
        .orderBy(asc(conversationsTable.createdAt))
        .limit(1);
      drizzleConversation = drizzleRows[0]
        ? this.mapDrizzleConversationRow(drizzleRows[0])
        : null;
    } catch (err) {
      this.logDrizzle('getOrCreateDefaultConversation', 'drizzle primary failed, returning legacy', err);
      return existing;
    }

    if (!drizzleConversation) {
      return existing;
    }

    const matches = await this.compareDefaultConversationWithDrizzle(
      existing,
      workspaceId,
      drizzleConversation,
    );
    if (!matches) {
      return existing;
    }

    return drizzleConversation;
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
    const sqliteDb = this.db;
    if (!sqliteDb) throw new Error('Database not initialized');

    const fetchLegacy = () =>
      new Promise<Message[]>((resolve, reject) => {
        sqliteDb.all(
          `
          SELECT * FROM messages 
          WHERE conversation_id = ? 
          ORDER BY timestamp ASC
        `,
          [conversationId],
          (err, rows: any[]) => {
            if (err) {
              reject(err);
            } else {
              resolve(
                rows.map((row) => ({
                  id: row.id,
                  conversationId: row.conversation_id,
                  content: row.content,
                  sender: row.sender as 'user' | 'agent',
                  timestamp: row.timestamp,
                  metadata: row.metadata ?? undefined,
                })),
              );
            }
          },
        );
      });

    const fetchDrizzle = async () => {
      const { db } = await getDrizzleClient();
      const drizzleRows = await db
        .select()
        .from(messagesTable)
        .where(eq(messagesTable.conversationId, conversationId))
        .orderBy(asc(messagesTable.timestamp));
      return drizzleRows.map((row) => this.mapDrizzleMessageRow(row));
    };

    const useDrizzle = featureFlags.useDrizzleReads();

    if (!useDrizzle) {
      return fetchLegacy();
    }

    let drizzleMessages: Message[];
    try {
      drizzleMessages = await fetchDrizzle();
    } catch (err) {
      this.logDrizzle('getMessages', 'drizzle primary failed, falling back to legacy', err);
      return fetchLegacy();
    }

    const legacyMessages = await fetchLegacy();
    const matches = await this.compareMessagesWithDrizzle(
      legacyMessages,
      conversationId,
      drizzleMessages,
    );
    if (!matches) {
      return legacyMessages;
    }

    return drizzleMessages;
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

  private async compareProjectsWithDrizzle(
    legacyProjects: Project[],
    drizzleProjects?: Project[],
  ): Promise<boolean> {
    try {
      let drizzle = drizzleProjects;
      if (!drizzle) {
        const { db } = await getDrizzleClient();
        const drizzleRows = await db
          .select()
          .from(projectsTable)
          .orderBy(desc(projectsTable.updatedAt));
        drizzle = drizzleRows.map((row) => this.mapDrizzleProjectRow(row));
      }

      if (!isDeepStrictEqual(legacyProjects, drizzle)) {
        this.logDrizzle('getProjects', 'result mismatch', {
          legacy: legacyProjects,
          drizzle,
        });

        if (featureFlags.drizzleDiffAssertions()) {
          throw new Error('Drizzle getProjects diff detected');
        }
        return false;
      }

      return true;
    } catch (err) {
      this.logDrizzle('getProjects', 'drizzle query failed', err);
      if (featureFlags.drizzleDiffAssertions()) {
        throw err;
      }
      return false;
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
      status: (row.status ?? 'idle') as Workspace['status'],
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

  private async compareWorkspacesWithDrizzle(
    legacyWorkspaces: Workspace[],
    projectId?: string,
    drizzleWorkspaces?: Workspace[],
  ): Promise<boolean> {
    try {
      let drizzle = drizzleWorkspaces;
      if (!drizzle) {
        const { db } = await getDrizzleClient();
        const query = db.select().from(workspacesTable).orderBy(desc(workspacesTable.updatedAt));
        const drizzleRows = projectId
          ? await query.where(eq(workspacesTable.projectId, projectId))
          : await query;
        drizzle = drizzleRows.map((row) => this.mapDrizzleWorkspaceRow(row));
      }

      if (!isDeepStrictEqual(legacyWorkspaces, drizzle)) {
        this.logDrizzle('getWorkspaces', 'result mismatch', {
          legacy: legacyWorkspaces,
          drizzle,
        });

        if (featureFlags.drizzleDiffAssertions()) {
          throw new Error('Drizzle getWorkspaces diff detected');
        }
        return false;
      }

      return true;
    } catch (err) {
      this.logDrizzle('getWorkspaces', 'drizzle query failed', err);
      if (featureFlags.drizzleDiffAssertions()) {
        throw err;
      }
      return false;
    }
  }

  private async compareConversationsWithDrizzle(
    legacyConversations: Conversation[],
    workspaceId: string,
    drizzleConversations?: Conversation[],
  ): Promise<boolean> {
    try {
      let drizzle = drizzleConversations;
      if (!drizzle) {
        const { db } = await getDrizzleClient();
        const drizzleRows = await db
          .select()
          .from(conversationsTable)
          .where(eq(conversationsTable.workspaceId, workspaceId))
          .orderBy(desc(conversationsTable.updatedAt));
        drizzle = drizzleRows.map((row) => this.mapDrizzleConversationRow(row));
      }

      if (!isDeepStrictEqual(legacyConversations, drizzle)) {
        this.logDrizzle('getConversations', 'result mismatch', {
          legacy: legacyConversations,
          drizzle,
        });

        if (featureFlags.drizzleDiffAssertions()) {
          throw new Error('Drizzle getConversations diff detected');
        }
        return false;
      }

      return true;
    } catch (err) {
      this.logDrizzle('getConversations', 'drizzle query failed', err);
      if (featureFlags.drizzleDiffAssertions()) {
        throw err;
      }
      return false;
    }
  }

  private async compareDefaultConversationWithDrizzle(
    legacyConversation: Conversation,
    workspaceId: string,
    drizzleConversation?: Conversation | null,
  ): Promise<boolean> {
    try {
      let drizzle = drizzleConversation;
      if (drizzle === undefined) {
        const { db } = await getDrizzleClient();
        const drizzleRows = await db
          .select()
          .from(conversationsTable)
          .where(eq(conversationsTable.workspaceId, workspaceId))
          .orderBy(asc(conversationsTable.createdAt))
          .limit(1);
        drizzle = drizzleRows[0] ? this.mapDrizzleConversationRow(drizzleRows[0]) : null;
      }

      if (!drizzle) {
        this.logDrizzle('getOrCreateDefaultConversation', 'drizzle missing conversation', {
          workspaceId,
        });

        if (featureFlags.drizzleDiffAssertions()) {
          throw new Error('Drizzle default conversation missing');
        }
        return false;
      }

      if (!isDeepStrictEqual(legacyConversation, drizzle)) {
        this.logDrizzle('getOrCreateDefaultConversation', 'result mismatch', {
          legacy: legacyConversation,
          drizzle,
        });

        if (featureFlags.drizzleDiffAssertions()) {
          throw new Error('Drizzle default conversation diff detected');
        }
        return false;
      }

      return true;
    } catch (err) {
      this.logDrizzle('getOrCreateDefaultConversation', 'drizzle query failed', err);
      if (featureFlags.drizzleDiffAssertions()) {
        throw err;
      }
      return false;
    }
  }

  private async compareMessagesWithDrizzle(
    legacyMessages: Message[],
    conversationId: string,
    drizzleMessages?: Message[],
  ): Promise<boolean> {
    try {
      let drizzle = drizzleMessages;
      if (!drizzle) {
        const { db } = await getDrizzleClient();
        const drizzleRows = await db
          .select()
          .from(messagesTable)
          .where(eq(messagesTable.conversationId, conversationId))
          .orderBy(asc(messagesTable.timestamp));
        drizzle = drizzleRows.map((row) => this.mapDrizzleMessageRow(row));
      }

      if (!isDeepStrictEqual(legacyMessages, drizzle)) {
        this.logDrizzle('getMessages', 'result mismatch', {
          legacy: legacyMessages,
          drizzle,
        });

        if (featureFlags.drizzleDiffAssertions()) {
          throw new Error('Drizzle getMessages diff detected');
        }
        return false;
      }

      return true;
    } catch (err) {
      this.logDrizzle('getMessages', 'drizzle query failed', err);
      if (featureFlags.drizzleDiffAssertions()) {
        throw err;
      }
      return false;
    }
  }

  private logDrizzle(context: string, message: string, payload: unknown): void {
    const prefix = this.getDrizzleLogPrefix();
    console.warn(`${prefix} ${context}: ${message}`, payload);
  }
}

export const databaseService = new DatabaseService();
