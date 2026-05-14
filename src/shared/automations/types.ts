import type { ActionSpec } from '@shared/automations/actions';

export const AUTOMATION_NAME_MAX_LENGTH = 120;

export type TriggerSpec = { kind: 'cron'; expr: string; tz: string };

export type Automation = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  trigger: TriggerSpec;
  actions: ActionSpec[];
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
  startedAt: number;
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
  defaultTrigger: TriggerSpec;
  defaultActions: ActionSpec[];
};

export type CreateAutomationInput = {
  name: string;
  description?: string | null;
  category: string;
  trigger: TriggerSpec;
  actions: ActionSpec[];
  projectId: string;
  enabled?: boolean;
  isDraft?: boolean;
  builtinTemplateId?: string | null;
};

export type UpdateAutomationPatch = Partial<
  Pick<
    CreateAutomationInput,
    'name' | 'description' | 'category' | 'trigger' | 'actions' | 'projectId' | 'builtinTemplateId'
  > & { enabled: boolean; isDraft: boolean }
>;
