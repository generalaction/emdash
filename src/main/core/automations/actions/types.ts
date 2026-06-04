import type { Automation } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';

export type ActionContext = {
  automation: Automation;
  run: AutomationRun;
};

export type ActionOutcome = {
  taskId?: string;
  message?: string;
};

export type ActionError = {
  message: string;
  taskId?: string;
};
