import { getIssuesClient } from '@core/features/issues/api/browser/client';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';

export async function refreshLinkedIssueContext(
  issue: LinkedIssue,
  projectId: string | undefined
): Promise<LinkedIssue> {
  if (!projectId) return issue;

  const result = await getIssuesClient()
    .then((client) =>
      client.getIssueContext({
        provider: issue.provider,
        options: { identifier: issue.identifier, projectId },
      })
    )
    .catch(() => undefined);
  if (!result?.success) return issue;

  return result.data;
}
