import { type AutomationRow, type AutomationRunRow } from '@main/db/schema';
import type { Automation } from '@shared/core/automations/automation';
import type {
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTriggerKind,
  RunError,
} from '@shared/core/automations/automation-run';
import {
  automationConversationConfig,
  automationTriggerConfig,
  storedAutomationTaskConfig,
} from '@shared/core/automations/config';

function parseRunError(raw: string | null | undefined): RunError | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'step' in parsed &&
      'code' in parsed &&
      typeof (parsed as RunError).step === 'string' &&
      typeof (parsed as RunError).code === 'string'
    ) {
      return parsed as RunError;
    }
  } catch {
    // fall through
  }
  return null;
}

export function mapAutomationRowToAutomation(row: AutomationRow): Automation {
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId ?? undefined,
    triggerConfig: row.triggerConfig ?? undefined,
    conversationConfig: row.conversationConfig ?? undefined,
    taskConfig: row.taskConfig ?? undefined,
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
    triggerConfigSnapshot: automationTriggerConfig.parseJson(row.triggerConfigSnapshot) ?? {
      expr: '',
    },
    conversationConfigSnapshot: automationConversationConfig.parseJson(
      row.conversationConfigSnapshot
    ) ?? {
      prompt: '',
      provider: '',
      autoApprove: false,
    },
    taskConfigSnapshot: storedAutomationTaskConfig.parseJson(row.taskConfigSnapshot),
    scheduledAt: row.scheduledAt,
    deadlineAt: row.deadlineAt,
    startedAt: row.startedAt,
    taskCreatedAt: row.taskCreatedAt,
    launchedAt: row.launchedAt,
    finishedAt: row.finishedAt,
    taskId,
    generatedTaskName: row.generatedTaskName ?? null,
    error: parseRunError(row.error),
  };
}
