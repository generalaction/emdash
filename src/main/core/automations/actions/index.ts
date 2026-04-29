import type { ActionSpec } from '@shared/automations/actions';
import { err, type Result } from '@shared/result';
import { executeIssueComment } from './issueComment';
import { executeIssueCreate } from './issueCreate';
import { executeNotificationSend } from './notificationSend';
import { executePrComment } from './prComment';
import { executeTaskCreate } from './taskCreate';
import type { ActionContext, ActionOutcome } from './types';

export async function executeAction(
  action: ActionSpec,
  context: ActionContext
): Promise<Result<ActionOutcome, string>> {
  switch (action.kind) {
    case 'task.create':
      return executeTaskCreate(action, context);
    case 'issue.create':
      return executeIssueCreate(action, context);
    case 'issue.comment':
      return executeIssueComment(action, context);
    case 'pr.comment':
      return executePrComment(action, context);
    case 'notification.send':
      return executeNotificationSend(action, context);
    default: {
      const exhaustive: never = action;
      return err(`unknown_action_kind:${(exhaustive as { kind: string }).kind}`);
    }
  }
}
