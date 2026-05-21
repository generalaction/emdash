import { refreshLinkedIssueContext } from '@renderer/features/tasks/issue-context/refresh-linked-issue-context';
import type { Issue } from '@shared/tasks';
import {
  buildContextActionText,
  buildLinkedIssueContextAction,
  type ContextAction,
} from './context-actions';

const PROVIDERS_WITH_CONTEXT = new Set<Issue['provider']>(['linear', 'plain']);

export async function resolveContextActionText(args: {
  action: ContextAction;
  linkedIssue?: Issue;
  projectId?: string;
}): Promise<string> {
  const { action, linkedIssue, projectId } = args;
  if (
    action.kind !== 'linked-issue' ||
    !linkedIssue ||
    !PROVIDERS_WITH_CONTEXT.has(linkedIssue.provider)
  ) {
    return buildContextActionText(action);
  }

  const refreshedIssue = await refreshLinkedIssueContext(linkedIssue, projectId);
  const refreshedAction = buildLinkedIssueContextAction(refreshedIssue);
  return refreshedAction ? buildContextActionText(refreshedAction) : buildContextActionText(action);
}
