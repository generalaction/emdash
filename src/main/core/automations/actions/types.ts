import type { Automation, AutomationRun } from '@shared/automations/types';

export type ActionContext = {
  automation: Automation;
  run?: AutomationRun;
};

export type ActionOutcome = {
  taskId?: string;
  sessionId?: string;
  message?: string;
};

export type ActionError = {
  message: string;
  taskId?: string;
};
