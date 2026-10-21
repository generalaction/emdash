import { getIssuesClient } from '@core/features/issues/api/browser/client';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';

export async function refreshLinkedIssueContext(
  issue: LinkedIssue,
  projectId: string | undefined
): Promise<LinkedIssue> {
  if (!projectId || (!issue.accountId && !issue.url)) return issue;

  const result = await getIssuesClient()
    .then((client) =>
      client.getIssueContext({
        provider: issue.provider,
        options: {
          identifier: issue.identifier,
          projectId,
          accountId: issue.accountId,
          issueUrl: issue.url || undefined,
        },
      })
    )
    .catch(() => undefined);
  if (!result?.success) return issue;

  return result.data;
}
