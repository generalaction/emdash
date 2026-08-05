import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * One row per workspace record (ADR 0005). Plain columns for identity fields and
 * registry-maintained timestamps; versioned house-pattern JSON (see payload-codecs.ts)
 * for the creation fields, the last create outcome, and the git observation block. The
 * runtime overlay is deliberately NOT here — it is in-memory session-plane state that
 * dies with the daemon.
 */
export const workspaceRecords = sqliteTable(
  'workspace_records',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['repository', 'worktree', 'directory'] }).notNull(),
    path: text('path').notNull(),
    parentId: text('parent_id'),
    origin: text('origin', { enum: ['registered', 'adopted'] }).notNull(),
    gitAdminName: text('git_admin_name'),
    observedStatus: text('observed_status', { enum: ['present', 'missing'] }).notNull(),
    /** Versioned JSON: immutable creation fields; null unless born from createWorktree. */
    creation: text('creation'),
    /** Versioned JSON: durable outcome of the last createWorktree attempt. */
    lastCreateOutcome: text('last_create_outcome'),
    /** Versioned JSON: host-computed git observation block; null for plain directories. */
    git: text('git'),
    lastActivatedAt: integer('last_activated_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    lastObservedAt: integer('last_observed_at').notNull(),
  },
  (table) => [uniqueIndex('workspace_records_path_unique').on(table.path)]
);
