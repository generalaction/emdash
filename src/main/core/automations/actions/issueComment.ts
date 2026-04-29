import type { IssueCommentAction } from '@shared/automations/actions';
import { err, ok, type Result } from '@shared/result';
import { jiraConnectionService } from '@main/core/jira/jira-connection-service';
import { jiraPostJson, plainTextToAdf } from '@main/core/jira/jira-http';
import { linearConnectionService } from '@main/core/linear/linear-connection-service';
import { plainConnectionService } from '@main/core/plain/plain-connection-service';
import { postScmComment } from './scm-comment';
import { applyTemplate } from './template';
import type { ActionExecutor, ActionOutcome } from './types';

export const executeIssueComment: ActionExecutor<IssueCommentAction> = async (action, ctx) => {
  const body = applyTemplate(action.body, ctx.event);
  if (!body.trim()) return err('issue_comment_body_empty');

  const ref = applyTemplate(action.issueRef, ctx.event).trim();
  if (!ref) return err('issue_comment_ref_empty');

  try {
    switch (action.provider) {
      case 'github':
      case 'gitlab':
      case 'forgejo':
        return await postScmComment(action.provider, ctx.automation.projectId, ref, body, 'issue');
      case 'jira':
        return await commentJiraIssue(ref, body);
      case 'linear':
        return await commentLinearIssue(ref, body);
      case 'plain':
        return await commentPlainThread(ref, body);
      default: {
        const exhaustive: never = action.provider;
        return err(`unknown_issue_provider:${exhaustive as string}`);
      }
    }
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
};

async function commentJiraIssue(ref: string, body: string): Promise<Result<ActionOutcome, string>> {
  const { siteUrl, email, token } = await jiraConnectionService.requireAuth();
  await jiraPostJson(
    siteUrl,
    email,
    token,
    `/rest/api/3/issue/${encodeURIComponent(ref)}/comment`,
    {
      body: plainTextToAdf(body),
    }
  );
  const base = siteUrl.replace(/\/$/, '');
  return ok({ message: `Comment posted on ${base}/browse/${ref}` });
}

async function commentLinearIssue(
  ref: string,
  body: string
): Promise<Result<ActionOutcome, string>> {
  const client = await linearConnectionService.getClient();
  if (!client) return err('linear_not_configured');

  const issue = await client.issue(ref);
  if (!issue?.id) return err(`linear_issue_not_found:${ref}`);

  const payload = await client.createComment({ issueId: issue.id, body });
  if (!payload.success) return err('linear_comment_create_failed');
  return ok({ message: `Comment posted on ${issue.identifier ?? ref}` });
}

async function commentPlainThread(
  threadId: string,
  body: string
): Promise<Result<ActionOutcome, string>> {
  const client = await plainConnectionService.getClient();
  if (!client) return err('plain_not_configured');

  const result = await client.mutation.replyToThread({
    input: { threadId, textContent: body, markdownContent: body },
  });
  if (result?.error) return err(`plain_reply_failed:${result.error.message ?? 'unknown'}`);
  return ok({ message: `Comment posted on Plain thread ${threadId}` });
}
