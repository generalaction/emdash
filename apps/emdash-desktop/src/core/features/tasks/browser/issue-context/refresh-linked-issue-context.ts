import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

export async function refreshLinkedIssueContext(
  issue: LinkedIssue,
  projectId: string | undefined
): Promise<LinkedIssue> {
  if (!projectId) return issue;

  const result = await getDesktopWireClient()
    .then((client) =>
      client.issues.getIssueContext({
        provider: issue.provider,
        options: { identifier: issue.identifier, projectId },
      })
    )
    .catch(() => undefined);
  if (!result?.success) return issue;

  return result.data;
}
