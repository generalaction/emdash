import type { Issue } from '@shared/tasks';
import { normalizeTaskName } from '@renderer/utils/taskNames';

export function getIssueTaskName(issue: Issue | null | undefined): string | null {
  if (issue?.provider !== 'linear') {
    return null;
  }

  const branchName = issue.branchName?.trim();
  if (!branchName) {
    return null;
  }

  const normalized = normalizeTaskName(branchName.replace(/\//g, '-'));
  return normalized || null;
}
