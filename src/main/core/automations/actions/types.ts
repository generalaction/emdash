import type { AutomationEvent } from '@shared/automations/events';
import type { Automation } from '@shared/automations/types';
import type { Result } from '@shared/result';

export type ActionContext = {
  automation: Automation;
  event: AutomationEvent | null;
};

export type ActionOutcome = {
  taskId?: string;
  sessionId?: string;
  message?: string;
};

export type ActionExecutor<A> = (
  action: A,
  context: ActionContext
) => Promise<Result<ActionOutcome, string>>;
