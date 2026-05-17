import type { Automation } from '@shared/automations/types';

export type ActionContext = {
  automation: Automation;
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
