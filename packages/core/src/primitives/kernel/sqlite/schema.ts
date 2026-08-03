import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { claimModes } from '../api/claim-modes';
import { operationStatuses } from '../api/record';

export const operations = sqliteTable(
  'operations',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    id: text('id').notNull(),
    name: text('name').notNull(),
    key: text('key').notNull(),
    input: text('input').notNull(),
    status: text('status', { enum: operationStatuses }).notNull(),
    attempt: integer('attempt').notNull(),
    notBefore: integer('not_before'),
    parentId: text('parent_id'),
    initiator: text('initiator').notNull(),
    propagation: text('propagation'),
    result: text('result'),
    rejectedError: text('rejected_error'),
    error: text('error'),
    outcome: text('outcome'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('operations_id_idx').on(t.id),
    index('operations_status_idx').on(t.status),
    index('operations_key_idx').on(t.key),
    index('operations_parent_status_idx').on(t.parentId, t.status),
  ]
);

export const operationClaims = sqliteTable(
  'operation_claims',
  {
    operationId: text('operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    resource: text('resource').notNull(),
    key: text('key').notNull(),
    mode: text('mode', { enum: claimModes }).notNull(),
    implicit: integer('implicit', { mode: 'boolean' }).notNull(),
  },
  (t) => [
    index('operation_claims_operation_idx').on(t.operationId),
    index('operation_claims_resource_key_idx').on(t.resource, t.key),
  ]
);

export const operationTransitions = sqliteTable(
  'operation_transitions',
  {
    operationId: text('operation_id')
      .notNull()
      .references(() => operations.id, { onDelete: 'cascade' }),
    from: text('from_status', { enum: operationStatuses }).notNull(),
    to: text('to_status', { enum: operationStatuses }).notNull(),
    at: integer('at').notNull(),
    cause: text('cause').notNull(),
  },
  (t) => [
    index('operation_transitions_operation_idx').on(t.operationId),
    index('operation_transitions_at_idx').on(t.at),
  ]
);
