import { normalizeTaskName } from '@renderer/utils/taskNames';
import type { LinkedIssue } from '@shared/core/linked-issue';

export function getIssueTaskName(
  issue: LinkedIssue | null | undefined,
  options?: { preserveCapitalization?: boolean }
): string | null {
  if (!issue) {
    return null;
  }

  const branchName = issue.branchName?.trim();
  if (!branchName) {
    return null;
  }

  const normalized = normalizeTaskName(branchName.replace(/\//g, '-'), options);
  return normalized || null;
}
