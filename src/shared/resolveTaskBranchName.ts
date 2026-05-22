import type { Issue } from '@shared/tasks';

type ResolveTaskBranchNameInput = {
  rawBranch: string;
  branchPrefix: string;
  suffix: string;
  appendRandomSuffix: boolean;
  linkedIssue?: Issue;
  disableRandomSuffix?: boolean;
};

export function resolveTaskBranchName({
  rawBranch,
  branchPrefix,
  suffix,
  appendRandomSuffix,
  linkedIssue,
  disableRandomSuffix = false,
}: ResolveTaskBranchNameInput): string {
  const linearBranchName =
    linkedIssue?.provider === 'linear' ? linkedIssue.branchName?.trim() : undefined;

  if (linearBranchName) {
    return linearBranchName;
  }

  const shouldAppendSuffix =
    appendRandomSuffix && !disableRandomSuffix && linkedIssue?.provider !== 'linear';
  const branch = shouldAppendSuffix ? `${rawBranch}-${suffix}` : rawBranch;
  return branchPrefix ? `${branchPrefix}/${branch}` : branch;
}
