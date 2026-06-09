import type { ConversationConfig, StoredAutomationTaskConfig, TriggerConfig } from './config';

export type AutomationRunStatus =
  | 'scheduled' // future cron slot, not yet due
  | 'queued' // due, awaiting a free slot
  | 'creating_task' // step 1 in progress
  | 'launching_task' // step 2 in progress (taskId + taskCreatedAt set)
  | 'creating_conversation' // step 3 in progress (launchedAt set)
  | 'done'
  | 'failed'
  | 'skipped';

export type AutomationRunTriggerKind = 'cron' | 'manual';

export type RunError = {
  step: 'queue' | 'create_task' | 'launch_task' | 'create_conversation';
  code: string;
  message?: string; // supplementary context (branch name, timeout ms, etc.)
};

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
  taskCreatedAt: number | null; // written when creating_task → launching_task
  launchedAt: number | null; // written when launching_task → creating_conversation
  finishedAt: number | null;
  taskId: string | null;
  generatedTaskName: string | null;
  error: RunError | null;
};
