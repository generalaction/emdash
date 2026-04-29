import type { PrCommentAction } from '@shared/automations/actions';
import { err } from '@shared/result';
import { postScmComment } from './scm-comment';
import { applyTemplate } from './template';
import type { ActionExecutor } from './types';

export const executePrComment: ActionExecutor<PrCommentAction> = async (action, ctx) => {
  const body = applyTemplate(action.body, ctx.event);
  if (!body.trim()) return err('pr_comment_body_empty');

  const ref = applyTemplate(action.prRef, ctx.event).trim();
  if (!ref) return err('pr_comment_ref_empty');

  try {
    return await postScmComment(action.provider, ctx.automation.projectId, ref, body, 'pr');
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
};
