import type { TaskCreateAction } from '@shared/automations/actions';
import type { CreateTaskParams } from '@shared/tasks';

export const AUTOMATION_NAME_MAX_LENGTH = 120;

export type CronTrigger = { expr: string; tz: string };

export type Automation = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  trigger: CronTrigger;
  actions: TaskCreateAction[];
  taskConfig: CreateTaskParams | null;
  projectId: string;
  enabled: boolean;
  isDraft: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  builtinTemplateId: string | null;
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
};

export type AutomationRunWithContext = AutomationRun & {
  automationName: string;
  projectId: string;
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
  taskConfig?: CreateTaskParams | null;
  projectId: string;
  enabled?: boolean;
  isDraft?: boolean;
  builtinTemplateId?: string | null;
};

export type UpdateAutomationPatch = Partial<
  Pick<
    CreateAutomationInput,
    'name' | 'description' | 'category' | 'trigger' | 'actions' | 'projectId' | 'builtinTemplateId'
  > & { taskConfig: CreateTaskParams | null; enabled: boolean; isDraft: boolean }
>;
