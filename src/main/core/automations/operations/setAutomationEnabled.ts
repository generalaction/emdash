import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { automations } from '@main/db/schema';

export async function setAutomationEnabled(id: string, enabled: boolean) {
  await db
    .update(automations)
    .set({ enabled: enabled ? 1 : 0 })
    .where(eq(automations.id, id));
}
