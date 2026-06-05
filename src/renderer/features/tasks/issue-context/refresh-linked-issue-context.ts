import { rpc } from '@renderer/lib/ipc';
import { ISSUE_PROVIDER_CAPABILITIES } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';

export async function refreshLinkedIssueContext(
  issue: Issue,
  projectId: string | undefined
): Promise<Issue> {
  if (!ISSUE_PROVIDER_CAPABILITIES[issue.provider].supportsIssueContext || !projectId) return issue;

  const result = await rpc.issues
    .getIssueContext(issue.provider, {
      identifier: issue.identifier,
      projectId,
    })
    .catch(() => undefined);
  if (!result?.success) return issue;

  return result.issue;
}
