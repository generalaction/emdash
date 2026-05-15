import type { ActionSpec } from '@shared/automations/actions';
import type { Result } from '@shared/result';
import { executeTaskCreate } from './taskCreate';
import type { ActionContext, ActionError, ActionOutcome } from './types';

export async function executeAction(
  action: ActionSpec,
  context: ActionContext
): Promise<Result<ActionOutcome, ActionError>> {
  return executeTaskCreate(action, context);
}
