import type { Issue } from '@shared/tasks';
import { refreshLinkedIssueContext } from '@renderer/features/tasks/issue-context/refresh-linked-issue-context';
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
  if (action.kind !== 'linked-issue' || linkedIssue?.provider !== 'linear') {
    return buildContextActionText(action);
  }

  const refreshedIssue = await refreshLinkedIssueContext(linkedIssue, projectId);
  const refreshedAction = buildLinkedIssueContextAction(refreshedIssue);
  return refreshedAction ? buildContextActionText(refreshedAction) : buildContextActionText(action);
}
