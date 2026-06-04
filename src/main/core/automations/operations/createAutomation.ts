import { randomUUID } from 'node:crypto';
import { db } from '@main/db/client';
import { automations } from '@main/db/schema';
import { CreateAutomationParams } from '@shared/automations/automation';
import { mapAutomationRowToAutomation } from '../utils';

export async function createAutomation(params: CreateAutomationParams) {
  const { name, triggerConfig, conversationConfig, taskConfig, projectId, enabled } = params;
  const [automationRow] = await db
    .insert(automations)
    .values({
      id: randomUUID(),
      name,
      triggerConfig: JSON.stringify(triggerConfig),
      conversationConfig: JSON.stringify(conversationConfig),
      taskConfig: taskConfig ? JSON.stringify(taskConfig) : null,
      projectId,
      enabled: enabled ? 1 : 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .returning();
  return mapAutomationRowToAutomation(automationRow);
}
