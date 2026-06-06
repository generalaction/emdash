import { normalizeTaskName } from '@renderer/utils/taskNames';
import type { LinkedIssue } from '@shared/linked-issue';

const PROVIDERS_WITH_BRANCH_NAMES = new Set<LinkedIssue['provider']>(['linear', 'plain']);

export function getIssueTaskName(
  issue: LinkedIssue | null | undefined,
  options?: { preserveCapitalization?: boolean }
): string | null {
  if (!issue || !PROVIDERS_WITH_BRANCH_NAMES.has(issue.provider)) {
    return null;
  }

  const branchName = issue.branchName?.trim();
  if (!branchName) {
    return null;
  }

  const normalized = normalizeTaskName(branchName.replace(/\//g, '-'), options);
  return normalized || null;
}
