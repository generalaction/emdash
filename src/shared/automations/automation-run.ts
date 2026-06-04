import type { ConversationConfig, StoredAutomationTaskConfig, TriggerConfig } from './config';

export type AutomationRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'skipped';

export type AutomationRunTriggerKind = 'cron' | 'manual';

export type AutomationRun = {
  id: string;
  automationId: string;
  status: AutomationRunStatus;
  triggerKind: AutomationRunTriggerKind;
  triggerConfigSnapshot: TriggerConfig;
  conversationConfigSnapshot: ConversationConfig;
  taskConfigSnapshot: StoredAutomationTaskConfig | null;
  scheduledAt: number | null;
  deadlineAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  taskId: string | null;
  error: string | null;
  workerId: string | null;
};

export type AutomationRunWithContext = AutomationRun & {
  automationName: string;
  projectId: string | null;
};
