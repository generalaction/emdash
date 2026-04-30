import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { StoredBranch } from '@main/core/tasks/stored-branch';

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
    metadata: text('metadata'), // JSON for additional connection-specific data
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
    workspaceProvider: text('workspace_provider').notNull().default('local'), // 'local' | 'ssh'
    baseRef: text('base_ref'),
    sshConnectionId: text('ssh_connection_id').references(() => sshConnections.id, {
      onDelete: 'set null',
    }),
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
  })
);

export const projectRemotes = sqliteTable(
  'project_remotes',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    remoteName: text('remote_name').notNull(),
    remoteUrl: text('remote_url').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.remoteName] }),
  })
);

export const appSettings = sqliteTable(
  'app_settings',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    keyIdx: uniqueIndex('idx_app_settings_key').on(table.key),
  })
);

export const promptTemplates = sqliteTable(
  'prompt_templates',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    text: text('text').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    sortOrderIdx: index('idx_prompt_templates_sort_order').on(table.sortOrder),
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
    status: text('status').notNull(),
    sourceBranch: text('source_branch', { mode: 'json' }).$type<StoredBranch>(),
    taskBranch: text('task_branch'),
    linkedIssue: text('linked_issue'),
    archivedAt: text('archived_at'), // null = active, timestamp = archived
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastInteractedAt: text('last_interacted_at'),
    statusChangedAt: text('status_changed_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    isPinned: integer('is_pinned').notNull().default(0), // boolean, 0=false, 1=true
    workspaceProvider: text('workspace_provider'), // 'local' | 'ssh' | null (null = inherit from project settings)
    workspaceId: text('workspace_id'),
    workspaceProviderData: text('workspace_provider_data'), // JSON, BYOI only
  },
  (table) => ({
    projectIdIdx: index('idx_tasks_project_id').on(table.projectId),
  })
);

export const pullRequestUsers = sqliteTable('pull_request_users', {
  userId: text('user_id').primaryKey(),
  userName: text('user_name').notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  url: text('url'),

  userUpdatedAt: text('user_updated_at'),
  userCreatedAt: text('user_created_at'),
});

export const pullRequests = sqliteTable(
  'pull_requests',
  {
    url: text('url').primaryKey(),
    provider: text('provider').notNull().default('github'),
    repositoryUrl: text('repository_url').notNull(),

    baseRefName: text('base_ref_name').notNull(),
    baseRefOid: text('base_ref_oid').notNull(),

    headRepositoryUrl: text('head_repository_url').notNull(),
    headRefName: text('head_ref_name').notNull(),
    headRefOid: text('head_ref_oid').notNull(),

    identifier: text('identifier'), // #123 for github
    title: text('title').notNull(),
    description: text('description'),
    status: text('status').notNull().default('open'),
    isDraft: integer('is_draft'),

    authorUserId: text('author_user_id').references(() => pullRequestUsers.userId, {
      onDelete: 'set null',
    }),

    additions: integer('additions'),
    deletions: integer('deletions'),
    changedFiles: integer('changed_files'),
    commitCount: integer('commit_count'),

    mergeableStatus: text('mergeable_status'),
    mergeStateStatus: text('merge_state_status'),
    reviewDecision: text('review_decision'),

    pullRequestCreatedAt: text('pull_request_created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    pullRequestUpdatedAt: text('pull_request_updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    urlIdx: uniqueIndex('idx_pull_requests_url').on(table.url),
    repositoryUrlIdx: index('idx_pull_requests_repository_url').on(table.repositoryUrl),
    headRepositoryUrlIdx: index('idx_pull_requests_head_repository_url').on(
      table.headRepositoryUrl
    ),
  })
);

export const pullRequestLabels = sqliteTable(
  'pull_request_labels',
  {
    pullRequestId: text('pull_request_id')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.pullRequestId, table.name] }),
    nameIdx: index('idx_prl_name').on(table.name),
  })
);

export const pullRequestAssignees = sqliteTable(
  'pull_request_assignees',
  {
    pullRequestUrl: text('pull_request_url')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => pullRequestUsers.userId, { onDelete: 'cascade' }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.pullRequestUrl, table.userId] }),
    pullRequestUrlIdx: index('idx_pra_pull_request_url').on(table.pullRequestUrl),
    userIdIdx: index('idx_pra_user_id').on(table.userId),
  })
);

export const pullRequestChecks = sqliteTable(
  'pull_request_checks',
  {
    id: text('id').primaryKey(),
    pullRequestUrl: text('pull_request_url')
      .notNull()
      .references(() => pullRequests.url, { onDelete: 'cascade' }),
    commitSha: text('commit_sha').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull(),
    conclusion: text('conclusion').notNull(),

    detailsUrl: text('details_url'),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    workflowName: text('workflow_name'),
    appName: text('app_name'),
    appLogoUrl: text('app_logo_url'),
  },
  (table) => ({
    pullRequestUrlIdx: index('idx_prc_pull_request_url').on(table.pullRequestUrl),
  })
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    provider: text('provider'),
    config: text('config'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskIdIdx: index('idx_conversations_task_id').on(table.taskId),
  })
);

export const terminals = sqliteTable(
  'terminals',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    ssh: integer('ssh').notNull().default(0), // boolean, 0=false, 1=true
    name: text('name').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    taskIdIdx: index('idx_terminals_task_id').on(table.taskId),
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

export const editorBuffers = sqliteTable(
  'editor_buffers',
  {
    id: text('id').primaryKey(), // `${projectId}:${workspaceId}:${filePath}`
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull(),
    filePath: text('file_path').notNull(),
    content: text('content').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => ({
    workspaceFileIdx: index('idx_editor_buffers_workspace_file').on(
      table.workspaceId,
      table.filePath
    ),
  })
);

export const kv = sqliteTable(
  'kv',
  {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
    updatedAt: integer('updated_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    keyIdx: uniqueIndex('idx_kv_key').on(table.key),
  })
);

export const appSecrets = sqliteTable(
  'app_secrets',
  {
    key: text('key').primaryKey(),
    secret: text('secret').notNull(),
  },
  (table) => ({
    keyIdx: uniqueIndex('idx_app_secrets_key').on(table.key),
  })
);

export type KvRow = typeof kv.$inferSelect;
export type KvInsert = typeof kv.$inferInsert;
export type AppSecretRow = typeof appSecrets.$inferSelect;
export type AppSecretInsert = typeof appSecrets.$inferInsert;

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

export type SshConnectionRow = typeof sshConnections.$inferSelect;
export type SshConnectionInsert = typeof sshConnections.$inferInsert;
export type PromptTemplateRow = typeof promptTemplates.$inferSelect;
export type PromptTemplateInsert = typeof promptTemplates.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type ConversationRow = typeof conversations.$inferSelect;
export type TerminalRow = typeof terminals.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type EditorBufferRow = typeof editorBuffers.$inferSelect;
export type EditorBufferInsert = typeof editorBuffers.$inferInsert;
