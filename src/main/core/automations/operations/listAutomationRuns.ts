import { eq, desc } from 'drizzle-orm';
import { db } from '@main/db/client';
import { automationRuns } from '@main/db/schema';
import { AutomationRun } from '@shared/automations/automation-run';
import { mapAutomationRunRowToAutomationRun } from '../utils';

export async function listAutomationRuns(
  automationId: string,
  limit: number,
  offset: number
): Promise<AutomationRun[]> {
  const rows = await db
    .select()
    .from(automationRuns)
    .where(eq(automationRuns.automationId, automationId))
    .orderBy(desc(automationRuns.scheduledAt))
    .limit(limit)
    .offset(offset);
  return rows.map(mapAutomationRunRowToAutomationRun);
}
