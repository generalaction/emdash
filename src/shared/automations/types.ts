import type { ActionSpec } from '@shared/automations/actions';
import type { AutomationEventKind, EventTriggerFilters } from '@shared/automations/events';

export const AUTOMATION_NAME_MAX_LENGTH = 120;

export type TriggerSpec =
  | { kind: 'cron'; expr: string; tz: string }
  | {
      kind: 'event';
      event: AutomationEventKind;
      filters?: EventTriggerFilters;
    };

export type Automation = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  trigger: TriggerSpec;
  actions: ActionSpec[];
  projectId: string;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  builtinTemplateId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type AutomationRunStatus = 'running' | 'success' | 'failed' | 'skipped';
export type AutomationRunTriggerKind = 'cron' | 'manual' | 'event';

export type AutomationRun = {
  id: string;
  automationId: string;
  startedAt: number;
  finishedAt: number | null;
  status: AutomationRunStatus;
  taskId: string | null;
  error: string | null;
  triggerKind: AutomationRunTriggerKind;
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
  builtinTemplateId?: string | null;
};

export type UpdateAutomationPatch = Partial<
  Pick<
    CreateAutomationInput,
    'name' | 'description' | 'category' | 'trigger' | 'actions' | 'projectId' | 'builtinTemplateId'
  > & { enabled: boolean }
>;
