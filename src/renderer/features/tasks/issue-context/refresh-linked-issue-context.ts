import { rpc } from '@renderer/lib/ipc';
import type { Issue } from '@shared/tasks';

export async function refreshLinkedIssueContext(
  issue: Issue,
  projectId: string | undefined
): Promise<Issue> {
  if (issue.provider !== 'linear' || !projectId) return issue;

  const result = await rpc.issues
    .getIssueContext('linear', {
      identifier: issue.identifier,
      projectId,
    })
    .catch(() => undefined);
  if (!result?.success) return issue;

  return result.issue;
}
