import { getIssuesClient } from '@core/features/issues/api/browser/client';
import { isDifferentSource, type LinkedIssue } from '@core/primitives/linked-issues/api';

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

  const refreshed = result.data;
  // Never overwrite the linked issue with a result from a different workspace:
  // the project may now resolve to another Linear workspace with the same
  // identifier, which must not reach the task/agent.
  if (isDifferentSource(issue, refreshed)) return issue;

  return refreshed;
}
