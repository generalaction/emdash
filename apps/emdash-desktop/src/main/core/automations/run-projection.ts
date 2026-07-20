import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import { inArray, sql } from 'drizzle-orm';
import { automationRuns, type AutomationRunRow } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';

export async function upsertRunProjection(run: AutomationRun): Promise<void> {
  await getAppDb()
    .insert(automationRuns)
    .values({
      id: run.id,
      automationId: run.automationId,
      automationName: run.configSnapshot.name,
      status: run.status,
      scheduledAt: run.scheduledAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      seq: run.seq,
    })
    .onConflictDoUpdate({
      target: automationRuns.id,
      set: {
        automationId: run.automationId,
        automationName: run.configSnapshot.name,
        status: run.status,
        scheduledAt: run.scheduledAt,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        seq: run.seq,
      },
      setWhere: sql`excluded.seq > ${automationRuns.seq}`,
    });
}

export async function getRunProjectionsByRunIds(
  runIds: readonly string[]
): Promise<AutomationRunRow[]> {
  const uniqueRunIds = [...new Set(runIds)];
  if (uniqueRunIds.length === 0) return [];
  return getAppDb().select().from(automationRuns).where(inArray(automationRuns.id, uniqueRunIds));
}
