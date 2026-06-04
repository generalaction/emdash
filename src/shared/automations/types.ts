import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { TaskCreateAction } from '@shared/automations/actions';
import type { TaskConfig } from '@shared/task-config';
import type { WorkspaceConfig } from '@shared/workspace-config';

export const AUTOMATION_NAME_MAX_LENGTH = 120;

export type CronTrigger = { expr: string; tz: string };

export type AutomationDeadlinePolicy = 'next-interval' | 'fixed' | 'none';

/** Configuration stored on an automation row — no per-run id/projectId. */
export type StoredAutomationTaskConfig = {
  taskConfig: TaskConfig;
  workspaceConfig: WorkspaceConfig;
};

export type Automation = {
  id: string;
  projectId: string | null;
  name: string;
  description: string | null;
  category: string;
  trigger: CronTrigger;
  actions: TaskCreateAction[];
  taskConfig: StoredAutomationTaskConfig | null;
  /** Controls cron scheduling only. Manual runs are allowed while false. */
  enabled: boolean;
  isDraft: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  deadlinePolicy: AutomationDeadlinePolicy;
  deadlineMs: number | null;
  createdAt: number;
  updatedAt: number;
};

export type AutomationRunStatus = 'queued' | 'running' | 'success' | 'failed' | 'skipped';
export type AutomationRunTriggerKind = 'cron' | 'manual';

export type AutomationRun = {
  id: string;
  automationId: string;
  scheduledAt: number | null;
  deadlineAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  status: AutomationRunStatus;
  taskId: string | null;
  createdTaskId: string | null;
  error: string | null;
  triggerKind: AutomationRunTriggerKind;
  workerId: string | null;
  /** Provider that actually backed this run, when it can be resolved from its created task. */
  agentProviderId?: AgentProviderId | null;
};

export type AutomationRunWithContext = AutomationRun & {
  automationName: string;
  projectId: string | null;
};

export type BuiltinAutomationTemplate = {
  id: string;
  category: string;
  name: string;
  description: string;
  icon: string;
  defaultTrigger: CronTrigger;
  defaultActions: TaskCreateAction[];
};

export type CreateAutomationInput = {
  name: string;
  description?: string | null;
  category: string;
  trigger: CronTrigger;
  actions: TaskCreateAction[];
  taskConfig?: StoredAutomationTaskConfig | null;
  projectId: string;
  enabled?: boolean;
  isDraft?: boolean;
  deadlinePolicy?: AutomationDeadlinePolicy;
  deadlineMs?: number | null;
};

export type UpdateAutomationPatch = Partial<
  Pick<
    CreateAutomationInput,
    | 'name'
    | 'description'
    | 'category'
    | 'trigger'
    | 'actions'
    | 'taskConfig'
    | 'projectId'
    | 'enabled'
    | 'isDraft'
    | 'deadlinePolicy'
    | 'deadlineMs'
  >
>;
