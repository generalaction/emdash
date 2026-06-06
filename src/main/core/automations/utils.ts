import { type AutomationRow, type AutomationRunRow } from '@main/db/schema';
import type { Automation } from '@shared/automations/automation';
import type {
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTriggerKind,
} from '@shared/automations/automation-run';

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

export function mapAutomationRunRowToAutomationRun(
  row: AutomationRunRow,
  taskId: string | null = null
): AutomationRun {
  return {
    id: row.id,
    automationId: row.automationId,
    status: row.status as AutomationRunStatus,
    triggerKind: row.triggerKind as AutomationRunTriggerKind,
    triggerConfigSnapshot: row.triggerConfigSnapshot
      ? JSON.parse(row.triggerConfigSnapshot)
      : undefined,
    conversationConfigSnapshot: row.conversationConfigSnapshot
      ? JSON.parse(row.conversationConfigSnapshot)
      : undefined,
    taskConfigSnapshot: row.taskConfigSnapshot ? JSON.parse(row.taskConfigSnapshot) : undefined,
    scheduledAt: row.scheduledAt,
    deadlineAt: row.deadlineAt,
    startedAt: row.startedAt,
    taskCreatedAt: row.taskCreatedAt,
    launchedAt: row.launchedAt,
    finishedAt: row.finishedAt,
    taskId,
    generatedTaskName: row.generatedTaskName ?? null,
    error: row.error,
  };
}
