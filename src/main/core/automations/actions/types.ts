import type { Automation } from '@shared/automations/types';
import type { Result } from '@shared/result';

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

export type ActionExecutor<A> = (
  action: A,
  context: ActionContext
) => Promise<Result<ActionOutcome, ActionError>>;
