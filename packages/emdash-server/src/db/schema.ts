import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    source: text('source'),          // 'github' | 'linear' | 'generic'
    payload: text('payload').notNull(),
    headers: text('headers'),        // JSON of relevant request headers
    status: text('status').notNull().default('pending'), // 'pending' | 'processed' | 'failed'
    error: text('error'),
    createdAt: integer('created_at').notNull(),
    processedAt: integer('processed_at'),
  },
  (table) => ({
    statusCreatedIdx: index('idx_webhook_events_status_created').on(table.status, table.createdAt),
    tokenIdx: index('idx_webhook_events_token').on(table.token),
  })
);

export type WebhookEventRow = typeof webhookEvents.$inferSelect;
export type InsertWebhookEvent = typeof webhookEvents.$inferInsert;
