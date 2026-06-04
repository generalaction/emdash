import { AutomationRow } from '@main/db/schema';
import { Automation } from '@shared/automations/automation';

export function mapAutomationRowToAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId ?? undefined,
    triggerConfig: row.triggerConfig ? JSON.parse(row.triggerConfig) : undefined,
    conversationConfig: row.conversationConfig ? JSON.parse(row.conversationConfig) : undefined,
    taskConfig: row.taskConfig ? JSON.parse(row.taskConfig) : undefined,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
