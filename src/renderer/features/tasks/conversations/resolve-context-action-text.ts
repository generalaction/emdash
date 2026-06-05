import { refreshLinkedIssueContext } from '@renderer/features/tasks/issue-context/refresh-linked-issue-context';
import { ISSUE_PROVIDER_CAPABILITIES } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import {
  buildContextActionText,
  buildLinkedIssueContextAction,
  type ContextAction,
} from './context-actions';

export async function resolveContextActionText(args: {
  action: ContextAction;
  linkedIssue?: Issue;
  projectId?: string;
}): Promise<string> {
  const { action, linkedIssue, projectId } = args;
  if (
    action.kind !== 'linked-issue' ||
    !linkedIssue ||
    !ISSUE_PROVIDER_CAPABILITIES[linkedIssue.provider].supportsIssueContext
  ) {
    return buildContextActionText(action);
  }

  const refreshedIssue = await refreshLinkedIssueContext(linkedIssue, projectId);
  const refreshedAction = buildLinkedIssueContextAction(refreshedIssue);
  return refreshedAction ? buildContextActionText(refreshedAction) : buildContextActionText(action);
}
