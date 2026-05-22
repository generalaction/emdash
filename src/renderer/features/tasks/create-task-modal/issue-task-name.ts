import { normalizeTaskName } from '@renderer/utils/taskNames';
import type { Issue } from '@shared/tasks';

const PROVIDERS_WITH_BRANCH_NAMES = new Set<Issue['provider']>(['linear', 'plain']);

export function getIssueTaskName(issue: Issue | null | undefined): string | null {
  if (!issue || !PROVIDERS_WITH_BRANCH_NAMES.has(issue.provider)) {
    return null;
  }

  const branchName = issue.branchName?.trim();
  if (!branchName) {
    return null;
  }

  const normalized = normalizeTaskName(branchName.replace(/\//g, '-'));
  return normalized || null;
}
