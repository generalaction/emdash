import { randomUUID } from 'node:crypto';
import { tasks } from '@main/db/schema';
import { log } from '@main/lib/logger';
import {
  isUniqueConstraintError,
  readLegacyRows,
  toIsoTimestamp,
  toTrimmedString,
} from './helpers';
import { createPortSummary, type PortContext, type PortSummary } from './types';

export type TaskPortResult = {
  summary: PortSummary;
  mergedLegacyTaskIds: Set<string>;
};

function coerceTaskStatus(
  rawStatus: string | undefined
): 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled' {
  const normalized = rawStatus?.trim().toLowerCase();

  if (normalized === 'idle') return 'todo';
  if (normalized === 'running' || normalized === 'active') return 'in_progress';
  if (normalized === 'review') return 'review';
  if (normalized === 'done' || normalized === 'completed') return 'done';
  if (normalized === 'cancelled') return 'cancelled';
  return 'todo';
}

export async function portTasks({ appDb, legacyDb, remap }: PortContext): Promise<TaskPortResult> {
  const summary = createPortSummary('tasks');
  const mergedLegacyTaskIds = new Set<string>();
  const nowIso = new Date().toISOString();

  const existingTaskRows = await appDb
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      taskBranch: tasks.taskBranch,
    })
    .from(tasks)
    .execute();

  const existingTaskIds = new Set<string>();
  const branchKeyToTaskId = new Map<string, string>();

  for (const row of existingTaskRows) {
    existingTaskIds.add(row.id);
    if (row.taskBranch) {
      branchKeyToTaskId.set(`${row.projectId}::${row.taskBranch}`, row.id);
    }
  }

  const legacyRows = readLegacyRows(legacyDb, 'tasks', [
    'id',
    'project_id',
    'name',
    'status',
    'branch',
    'archived_at',
    'created_at',
    'updated_at',
  ]);

  for (const row of legacyRows) {
    summary.considered += 1;

    const legacyTaskId = toTrimmedString(row.id);
    const legacyProjectId = toTrimmedString(row.project_id);

    if (!legacyTaskId || !legacyProjectId) {
      summary.skippedInvalid += 1;
      continue;
    }

    const mappedProjectId = remap.projectId.get(legacyProjectId);
    if (!mappedProjectId) {
      summary.skippedError += 1;
      continue;
    }

    const taskBranch = toTrimmedString(row.branch);
    if (taskBranch) {
      const existingTaskId = branchKeyToTaskId.get(`${mappedProjectId}::${taskBranch}`);
      if (existingTaskId) {
        remap.taskId.set(legacyTaskId, existingTaskId);
        mergedLegacyTaskIds.add(legacyTaskId);
        summary.skippedDedup += 1;
        continue;
      }
    }

    let nextTaskId = existingTaskIds.has(legacyTaskId) ? randomUUID() : legacyTaskId;

    const updatedAt = toIsoTimestamp(row.updated_at, nowIso);
    const createdAt = toIsoTimestamp(row.created_at, updatedAt);

    const insertValues = {
      id: nextTaskId,
      projectId: mappedProjectId,
      name: toTrimmedString(row.name) ?? taskBranch ?? `Legacy Task ${legacyTaskId.slice(0, 8)}`,
      status: coerceTaskStatus(toTrimmedString(row.status)),
      sourceBranch: null,
      taskBranch: taskBranch ?? null,
      archivedAt: toTrimmedString(row.archived_at) ?? null,
      createdAt,
      updatedAt,
      statusChangedAt: updatedAt,
      lastInteractedAt: updatedAt,
      isPinned: 0,
    };

    let inserted = false;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        insertValues.id = nextTaskId;
        await appDb.insert(tasks).values(insertValues).execute();
        inserted = true;
        break;
      } catch (error) {
        if (attempt === 0 && isUniqueConstraintError(error, 'tasks.id')) {
          nextTaskId = randomUUID();
          continue;
        }

        summary.skippedError += 1;
        log.warn('legacy-port: tasks: failed to insert row', {
          legacyTaskId,
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }

    if (!inserted) continue;

    remap.taskId.set(legacyTaskId, nextTaskId);
    existingTaskIds.add(nextTaskId);
    summary.inserted += 1;

    if (taskBranch) {
      branchKeyToTaskId.set(`${mappedProjectId}::${taskBranch}`, nextTaskId);
    }
  }

  return { summary, mergedLegacyTaskIds };
}
