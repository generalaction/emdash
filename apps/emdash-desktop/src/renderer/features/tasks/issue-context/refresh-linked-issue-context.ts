import { rpc } from '@renderer/lib/ipc';
import type { LinkedIssue } from '@shared/core/linked-issue';
import { ISSUE_PROVIDER_CAPABILITIES, type IssueAttachment } from '@shared/issue-providers';

export type RefreshedLinkedIssueContext = {
  issue: LinkedIssue;
  attachments?: IssueAttachment[];
};

export async function refreshLinkedIssueContext(
  issue: LinkedIssue,
  projectId: string | undefined
): Promise<RefreshedLinkedIssueContext> {
  if (!ISSUE_PROVIDER_CAPABILITIES[issue.provider].supportsIssueContext || !projectId) {
    return { issue };
  }

  const result = await rpc.issues
    .getIssueContext(issue.provider, {
      identifier: issue.identifier,
      projectId,
    })
    .catch(() => undefined);
  if (!result?.success) return { issue };

  return { issue: result.issue, attachments: result.attachments };
}
