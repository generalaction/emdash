import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { refreshLinkedIssueContext } from '@renderer/features/tasks/issue-context/refresh-linked-issue-context';
import { ISSUE_PROVIDER_CAPABILITIES } from '@shared/issue-providers';
import {
  buildContextActionText,
  buildIssueContextText,
  type ContextAction,
} from './context-actions';

export async function resolveContextActionText(args: {
  action: ContextAction;
  projectId?: string;
}): Promise<string> {
  const { action, projectId } = args;
  if (
    action.kind !== 'linked-issue' ||
    !ISSUE_PROVIDER_CAPABILITIES[action.issue.provider].supportsIssueContext
  ) {
    return buildContextActionText(action);
  }

  const { issue, attachments } = await refreshLinkedIssueContext(action.issue, projectId);
  // Local attachment paths would not exist on the remote host of an SSH project.
  const isSshProject = Boolean(projectId && getProjectSshConnectionId(projectId));
  return buildIssueContextText(issue, isSshProject ? undefined : attachments);
}
