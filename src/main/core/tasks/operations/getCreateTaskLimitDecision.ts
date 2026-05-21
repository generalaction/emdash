import { count, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import type { CreateTaskLimitDecision } from '@shared/tasks';

function getConfiguredTaskLimit(): number | null {
  const rawLimit = process.env.EMDASH_TASK_SOFT_LIMIT;
  if (!rawLimit) return null;

  const limit = Number(rawLimit);
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}

export async function getCreateTaskLimitDecision(
  _projectId: string
): Promise<CreateTaskLimitDecision> {
  const limit = getConfiguredTaskLimit();
  if (limit === null) return { kind: 'ok' };

  const [row] = await db.select({ count: count() }).from(tasks).where(isNull(tasks.archivedAt));

  const current = row?.count ?? 0;
  if (current < limit) return { kind: 'ok' };

  return { kind: 'soft-exceeded', current, limit };
}
