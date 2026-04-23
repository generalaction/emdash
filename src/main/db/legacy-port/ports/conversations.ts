import { randomUUID } from 'node:crypto';
import { log } from '@main/lib/logger';
import {
  isUniqueConstraintError,
  readLegacyRows,
  toIsoTimestamp,
  toTrimmedString,
} from './helpers';
import { createPortSummary, type PortContext, type PortSummary } from './types';

export function portConversations({
  appDb,
  legacyDb,
  remap,
  mergedLegacyTaskIds,
}: PortContext & { mergedLegacyTaskIds: Set<string> }): PortSummary {
  const summary = createPortSummary('conversations');
  const nowIso = new Date().toISOString();

  const taskRows = appDb.prepare(`SELECT id, project_id as projectId FROM tasks`).all() as Array<{
    id: string;
    projectId: string;
  }>;

  const taskIdToProjectId = new Map<string, string>();
  for (const row of taskRows) {
    taskIdToProjectId.set(row.id, row.projectId);
  }

  const existingConversationRows = appDb.prepare(`SELECT id FROM conversations`).all() as Array<{
    id: string;
  }>;
  const conversationIds = new Set<string>(existingConversationRows.map((row) => row.id));

  const legacyRows = readLegacyRows(legacyDb, 'conversations', [
    'id',
    'task_id',
    'title',
    'provider',
    'created_at',
    'updated_at',
  ]);

  const insertStatement = appDb.prepare(`
    INSERT INTO conversations (
      id,
      project_id,
      task_id,
      title,
      provider,
      config,
      created_at,
      updated_at
    )
    VALUES (
      @id,
      @projectId,
      @taskId,
      @title,
      @provider,
      NULL,
      @createdAt,
      @updatedAt
    )
  `);

  for (const row of legacyRows) {
    summary.considered += 1;

    const legacyTaskId = toTrimmedString(row.task_id);
    const legacyConversationId = toTrimmedString(row.id);

    if (!legacyTaskId || !legacyConversationId) {
      summary.skippedInvalid += 1;
      log.warn('legacy-port: conversations: skipping invalid row (missing id/task_id)', {
        legacyConversationId,
        legacyTaskId,
      });
      continue;
    }

    if (mergedLegacyTaskIds.has(legacyTaskId)) {
      summary.skippedDedup += 1;
      continue;
    }

    const mappedTaskId = remap.taskId.get(legacyTaskId);
    if (!mappedTaskId) {
      summary.skippedError += 1;
      log.warn('legacy-port: conversations: skipping row with unresolved task remap', {
        legacyConversationId,
        legacyTaskId,
      });
      continue;
    }

    const mappedProjectId = taskIdToProjectId.get(mappedTaskId);
    if (!mappedProjectId) {
      summary.skippedError += 1;
      log.warn('legacy-port: conversations: skipping row with unresolved project_id backfill', {
        legacyConversationId,
        mappedTaskId,
      });
      continue;
    }

    let nextConversationId = conversationIds.has(legacyConversationId)
      ? randomUUID()
      : legacyConversationId;

    const insertValues = {
      id: nextConversationId,
      projectId: mappedProjectId,
      taskId: mappedTaskId,
      title:
        toTrimmedString(row.title) ?? `Legacy conversation ${legacyConversationId.slice(0, 8)}`,
      provider: toTrimmedString(row.provider) ?? null,
      createdAt: toIsoTimestamp(row.created_at, nowIso),
      updatedAt: toIsoTimestamp(row.updated_at, nowIso),
    };

    let inserted = false;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        insertValues.id = nextConversationId;
        insertStatement.run(insertValues);
        inserted = true;
        break;
      } catch (error) {
        if (attempt === 0 && isUniqueConstraintError(error, 'conversations.id')) {
          nextConversationId = randomUUID();
          continue;
        }

        summary.skippedError += 1;
        log.warn('legacy-port: conversations: failed to insert row', {
          legacyConversationId,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    if (!inserted) continue;

    conversationIds.add(nextConversationId);
    summary.inserted += 1;
  }

  return summary;
}
