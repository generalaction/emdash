import type { PlainThread } from '../../../integrations/impl/plain/types';
import type { IssueData } from '../../types';

export function toIssueData(thread: PlainThread): IssueData {
  const identifier = thread.ref || thread.id;

  return {
    identifier,
    title: thread.title || identifier,
    description: thread.previewText ?? thread.description ?? undefined,
    status: thread.status,
    branchName: toBranchName(thread),
    updatedAt: thread.updatedAt?.iso8601,
  };
}

function toBranchName(thread: PlainThread): string | undefined {
  if (!thread.ref) return undefined;
  return thread.title ? `${thread.ref}-${thread.title}` : thread.ref;
}
