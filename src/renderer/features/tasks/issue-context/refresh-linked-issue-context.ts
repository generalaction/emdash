import { rpc } from '@renderer/lib/ipc';
import { ISSUE_PROVIDER_CAPABILITIES } from '@shared/issue-providers';
import type { LinkedIssue } from '@shared/linked-issue';

export async function refreshLinkedIssueContext(
  issue: LinkedIssue,
  projectId: string | undefined
): Promise<LinkedIssue> {
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
