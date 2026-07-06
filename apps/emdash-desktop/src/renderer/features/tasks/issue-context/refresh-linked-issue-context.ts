import { rpc } from '@renderer/lib/ipc';
import type { LinkedIssue } from '@shared/core/linked-issue';

export async function refreshLinkedIssueContext(
  issue: LinkedIssue,
  projectId: string | undefined
): Promise<LinkedIssue> {
  if (!projectId) return issue;

  const result = await rpc.issues
    .getIssueContext(issue.provider, {
      identifier: issue.identifier,
      projectId,
    })
    .catch(() => undefined);
  if (!result?.success) return issue;

  return result.data;
}
