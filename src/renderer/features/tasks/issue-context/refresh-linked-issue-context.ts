import { buildIssueContextText } from '@renderer/features/tasks/conversations/context-actions';
import { rpc } from '@renderer/lib/ipc';
import type { Issue } from '@shared/tasks';

export const PROVIDERS_WITH_CONTEXT = new Set<Issue['provider']>(['linear', 'plain']);

export async function refreshLinkedIssueContext(
  issue: Issue,
  projectId: string | undefined
): Promise<Issue> {
  if (!PROVIDERS_WITH_CONTEXT.has(issue.provider) || !projectId) return issue;

  const result = await rpc.issues
    .getIssueContext(issue.provider, {
      identifier: issue.identifier,
      projectId,
    })
    .catch(() => undefined);
  if (!result?.success) return issue;

  return result.issue;
}

export async function resolveLinkedIssueContextText(
  issue: Issue,
  projectId: string | undefined
): Promise<{ issue: Issue; text: string }> {
  const refreshedIssue = await refreshLinkedIssueContext(issue, projectId);
  return {
    issue: refreshedIssue,
    text: buildIssueContextText(refreshedIssue),
  };
}
