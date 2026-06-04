import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { automations } from '@main/db/schema';
import { Automation } from '@shared/automations/automation';
import { mapAutomationRowToAutomation } from '../utils';

export async function listAutomations(projectId?: string): Promise<Automation[]> {
  const query = projectId
    ? db.select().from(automations).where(eq(automations.projectId, projectId))
    : db.select().from(automations);
  const rows = await query;
  return rows.map(mapAutomationRowToAutomation);
}
