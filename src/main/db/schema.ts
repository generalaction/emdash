import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const sshConnections = sqliteTable(
  'ssh_connections',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull().default(22),
    username: text('username').notNull(),
    authType: text('auth_type').notNull().default('agent'), // 'password' | 'key' | 'agent'
    privateKeyPath: text('private_key_path'), // optional, for key auth
    useAgent: integer('use_agent').notNull().default(0), // boolean, 0=false, 1=true
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    nameIdx: uniqueIndex('idx_ssh_connections_name').on(table.name),
    hostIdx: index('idx_ssh_connections_host').on(table.host),
  })
);

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    gitRemote: text('git_remote'),
    gitBranch: text('git_branch'),
    baseRef: text('base_ref'),
    githubRepository: text('github_repository'),
    githubConnected: integer('github_connected').notNull().default(0),
    sshConnectionId: text('ssh_connection_id').references(() => sshConnections.id, {
      onDelete: 'set null',
    }),
    isRemote: integer('is_remote').notNull().default(0), // boolean, 0=false, 1=true
    remotePath: text('remote_path'), // path on remote server
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pathIdx: uniqueIndex('idx_projects_path').on(table.path),
    sshConnectionIdIdx: index('idx_projects_ssh_connection_id').on(table.sshConnectionId),
    isRemoteIdx: index('idx_projects_is_remote').on(table.isRemote),
  })
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    branch: text('branch').notNull(),
    path: text('path').notNull(),
    status: text('status').notNull().default('idle'),
    agentId: text('agent_id'),
    metadata: text('metadata'),
    useWorktree: integer('use_worktree').notNull().default(1),
    archivedAt: text('archived_at'), // null = active, timestamp = archived
    collectionId: text('collection_id'), // FK to collections for content tasks (nullable for non-content tasks)
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    projectIdIdx: index('idx_tasks_project_id').on(table.projectId),
    collectionIdIdx: index('idx_tasks_collection_id').on(table.collectionId),
  })
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    provider: text('provider'), // AI provider for this chat (claude, codex, qwen, etc.)
    isActive: integer('is_active').notNull().default(0), // 1 if this is the active chat for the task
    isMain: integer('is_main').notNull().default(0), // 1 if this is the main/primary chat (gets full persistence)
    displayOrder: integer('display_order').notNull().default(0), // Order in the tab bar
    metadata: text('metadata'), // JSON for additional chat-specific data
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskIdIdx: index('idx_conversations_task_id').on(table.taskId),
    activeIdx: index('idx_conversations_active').on(table.taskId, table.isActive), // Index for quick active conversation lookup
  })
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    sender: text('sender').notNull(),
    timestamp: text('timestamp')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    metadata: text('metadata'),
  },
  (table) => ({
    conversationIdIdx: index('idx_messages_conversation_id').on(table.conversationId),
    timestampIdx: index('idx_messages_timestamp').on(table.timestamp),
  })
);

export const lineComments = sqliteTable(
  'line_comments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    lineNumber: integer('line_number').notNull(),
    lineContent: text('line_content'),
    content: text('content').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    sentAt: text('sent_at'), // NULL = unsent, timestamp = when injected to chat
  },
  (table) => ({
    taskFileIdx: index('idx_line_comments_task_file').on(table.taskId, table.filePath),
  })
);

export const sshConnectionsRelations = relations(sshConnections, ({ many }) => ({
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  tasks: many(tasks),
  sshConnection: one(sshConnections, {
    fields: [projects.sshConnectionId],
    references: [sshConnections.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  conversations: many(conversations),
  lineComments: many(lineComments),
  contentOutputs: many(contentOutputs),
  collection: one(collections, {
    fields: [tasks.collectionId],
    references: [collections.id],
  }),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  task: one(tasks, {
    fields: [conversations.taskId],
    references: [tasks.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}));

export const lineCommentsRelations = relations(lineComments, ({ one }) => ({
  task: one(tasks, {
    fields: [lineComments.taskId],
    references: [tasks.id],
  }),
}));

// ============================================================================
// Content Workspace Tables
// ============================================================================

export const contentWorkspaces = sqliteTable(
  'content_workspaces',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kanbanColumns: text('kanban_columns').notNull(), // JSON array of column definitions
    defaultAgents: text('default_agents'), // JSON array of agent IDs
    metadata: text('metadata'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    projectIdIdx: index('idx_content_workspaces_project_id').on(table.projectId),
  })
);

export const brandGuidelines = sqliteTable(
  'brand_guidelines',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => contentWorkspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    content: text('content').notNull(), // Markdown content
    isActive: integer('is_active').notNull().default(1), // 1 = current brand guide
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    workspaceIdIdx: index('idx_brand_guidelines_workspace_id').on(table.workspaceId),
  })
);

export const collections = sqliteTable(
  'collections',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => contentWorkspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    workspaceIdIdx: index('idx_collections_workspace_id').on(table.workspaceId),
  })
);

export const knowledgeDocuments = sqliteTable(
  'knowledge_documents',
  {
    id: text('id').primaryKey(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(), // Filename
    content: text('content').notNull(), // Markdown content
    metadata: text('metadata'), // JSON for additional fields
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    collectionIdIdx: index('idx_knowledge_documents_collection_id').on(table.collectionId),
  })
);

export const contentOutputs = sqliteTable(
  'content_outputs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(), // Which agent generated this
    content: text('content').notNull(), // Markdown content
    version: integer('version').notNull().default(1),
    selected: integer('selected').notNull().default(0), // 1 = user's preferred version
    metadata: text('metadata'), // JSON (word count, etc.)
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskIdIdx: index('idx_content_outputs_task_id').on(table.taskId),
  })
);

// Content Workspace Relations
export const contentWorkspacesRelations = relations(contentWorkspaces, ({ one, many }) => ({
  project: one(projects, {
    fields: [contentWorkspaces.projectId],
    references: [projects.id],
  }),
  brandGuidelines: many(brandGuidelines),
  collections: many(collections),
}));

export const brandGuidelinesRelations = relations(brandGuidelines, ({ one }) => ({
  workspace: one(contentWorkspaces, {
    fields: [brandGuidelines.workspaceId],
    references: [contentWorkspaces.id],
  }),
}));

export const collectionsRelations = relations(collections, ({ one, many }) => ({
  workspace: one(contentWorkspaces, {
    fields: [collections.workspaceId],
    references: [contentWorkspaces.id],
  }),
  documents: many(knowledgeDocuments),
}));

export const knowledgeDocumentsRelations = relations(knowledgeDocuments, ({ one }) => ({
  collection: one(collections, {
    fields: [knowledgeDocuments.collectionId],
    references: [collections.id],
  }),
}));

export const contentOutputsRelations = relations(contentOutputs, ({ one }) => ({
  task: one(tasks, {
    fields: [contentOutputs.taskId],
    references: [tasks.id],
  }),
}));

export type SshConnectionRow = typeof sshConnections.$inferSelect;
export type SshConnectionInsert = typeof sshConnections.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type LineCommentRow = typeof lineComments.$inferSelect;
export type LineCommentInsert = typeof lineComments.$inferInsert;

// Content Workspace Types
export type ContentWorkspaceRow = typeof contentWorkspaces.$inferSelect;
export type ContentWorkspaceInsert = typeof contentWorkspaces.$inferInsert;
export type BrandGuidelineRow = typeof brandGuidelines.$inferSelect;
export type BrandGuidelineInsert = typeof brandGuidelines.$inferInsert;
export type CollectionRow = typeof collections.$inferSelect;
export type CollectionInsert = typeof collections.$inferInsert;
export type KnowledgeDocumentRow = typeof knowledgeDocuments.$inferSelect;
export type KnowledgeDocumentInsert = typeof knowledgeDocuments.$inferInsert;
export type ContentOutputRow = typeof contentOutputs.$inferSelect;
export type ContentOutputInsert = typeof contentOutputs.$inferInsert;
