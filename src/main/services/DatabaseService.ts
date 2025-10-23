import type sqlite3Type from 'sqlite3';
import { promisify } from 'util';
import { resolveDatabasePath } from '../db/path';

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
  agentId?: string;
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
    if (!this.db) throw new Error('Database not initialized');

    // Important: avoid INSERT OR REPLACE on projects. REPLACE deletes the existing
    // row to satisfy UNIQUE(path) which can cascade-delete related workspaces
    // (workspaces.project_id ON DELETE CASCADE). Use an UPSERT on the unique
    // path constraint that updates fields in-place and preserves the existing id.
    //
    // Semantics:
    // - If no row exists for this path: insert with the provided id.
    // - If a row exists for this path: update fields; do NOT change id or path.
    // - created_at remains intact on updates; updated_at is bumped.
    return new Promise((resolve, reject) => {
      this.db!.run(
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
        }
      );
    });
  }

  async getProjects(): Promise<Project[]> {
    if (this.disabled) return [];
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.all(
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
            const projects = rows.map((row) => ({
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
            }));
            resolve(projects);
          }
        }
      );
    });
  }

  async saveWorkspace(workspace: Omit<Workspace, 'createdAt' | 'updatedAt'>): Promise<void> {
    if (this.disabled) return;
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.run(
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
          typeof workspace.metadata === 'string'
            ? workspace.metadata
            : workspace.metadata
              ? JSON.stringify(workspace.metadata)
              : null,
        ],
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async getWorkspaces(projectId?: string): Promise<Workspace[]> {
    if (this.disabled) return [];
    if (!this.db) throw new Error('Database not initialized');

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

    return new Promise((resolve, reject) => {
      this.db!.all(query, params, (err, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          const workspaces = rows.map((row) => {
            let metadata: any = null;
            if (row.metadata) {
              try {
                metadata = JSON.parse(row.metadata);
              } catch (parseError) {
                console.warn('Failed to parse workspace metadata for', row.id, parseError);
                metadata = null;
              }
            }

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
          });
          resolve(workspaces);
        }
      });
    });
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
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.run(
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
        }
      );
    });
  }

  async getConversations(workspaceId: string): Promise<Conversation[]> {
    if (this.disabled) return [];
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.all(
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
            const conversations = rows.map((row) => ({
              id: row.id,
              workspaceId: row.workspace_id,
              title: row.title,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }));
            resolve(conversations);
          }
        }
      );
    });
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

    return new Promise((resolve, reject) => {
      // First, try to get existing conversations
      this.db!.all(
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
            this.db!.run(
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
  }

  // Message management methods
  async saveMessage(message: Omit<Message, 'timestamp'>): Promise<void> {
    if (this.disabled) return;
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.run(
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
          message.metadata || null,
        ],
        (err) => {
          if (err) {
            reject(err);
          } else {
            // Update conversation's updated_at timestamp
            this.db!.run(
              `
            UPDATE conversations 
            SET updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
          `,
              [message.conversationId],
              () => {
                resolve();
              }
            );
          }
        }
      );
    });
  }

  async getMessages(conversationId: string): Promise<Message[]> {
    if (this.disabled) return [];
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.all(
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
            const messages = rows.map((row) => ({
              id: row.id,
              conversationId: row.conversation_id,
              content: row.content,
              sender: row.sender as 'user' | 'agent',
              timestamp: row.timestamp,
              metadata: row.metadata,
            }));
            resolve(messages);
          }
        }
      );
    });
  }

  async deleteConversation(conversationId: string): Promise<void> {
    if (this.disabled) return;
    if (!this.db) throw new Error('Database not initialized');

    return new Promise((resolve, reject) => {
      this.db!.run('DELETE FROM conversations WHERE id = ?', [conversationId], (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
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
}

export const databaseService = new DatabaseService();
