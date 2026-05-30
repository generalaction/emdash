import {
  PROVIDERS_WITH_CONTEXT,
  resolveLinkedIssueContextText,
} from '@renderer/features/tasks/issue-context/refresh-linked-issue-context';
import type { Issue } from '@shared/tasks';
import { buildContextActionText, type ContextAction } from './context-actions';

export async function resolveContextActionText(args: {
  action: ContextAction;
  linkedIssue?: Issue;
  projectId?: string;
}): Promise<string> {
  const { action, linkedIssue, projectId } = args;
  if (action.kind !== 'linked-issue') {
    return buildContextActionText(action);
  }

  const issue = linkedIssue ?? action.issue;
  if (!PROVIDERS_WITH_CONTEXT.has(issue.provider)) return buildContextActionText(action);

  const { text } = await resolveLinkedIssueContextText(issue, projectId);
  return text;
}
