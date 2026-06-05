import type { PullRequest } from '@shared/pull-requests';

export type MergeSeverity = 'success' | 'warning' | 'error' | 'neutral';

export type MergeUiState = {
  kind: 'ready' | 'draft' | 'conflicts' | 'behind' | 'blocked' | 'unstable' | 'unknown';
  severity: MergeSeverity;
  title: string;
  detail?: string;
  canMerge: boolean;
  canBypassRequirements: boolean;
};

export function computeMergeUiState(pr: PullRequest): MergeUiState {
  if (pr.status !== 'open') {
    return {
      kind: 'unknown',
      severity: 'neutral',
      title: 'Merge status unknown',
      detail: 'Refresh PR status and try again.',
      canMerge: false,
      canBypassRequirements: false,
    };
  }
  if (pr.isDraft) {
    return {
      kind: 'draft',
      severity: 'neutral',
      title: 'Draft pull request',
      detail: 'Mark ready for review to enable merging.',
      canMerge: false,
      canBypassRequirements: false,
    };
  }
  switch (pr.mergeStateStatus) {
    case 'CLEAN':
      return {
        kind: 'ready',
        severity: 'success',
        title: 'Ready to merge',
        detail: 'No conflicts or required reviews.',
        canMerge: true,
        canBypassRequirements: false,
      };
    case 'DIRTY':
      return {
        kind: 'conflicts',
        severity: 'error',
        title: 'Merge conflicts',
        detail: 'Resolve conflicts before merging.',
        canMerge: false,
        canBypassRequirements: false,
      };
    case 'BEHIND':
      return {
        kind: 'behind',
        severity: 'warning',
        title: 'Branch is out-of-date',
        detail: 'Update the branch, or merge without waiting if your account can bypass rules.',
        canMerge: false,
        canBypassRequirements: true,
      };
    case 'BLOCKED':
      return {
        kind: 'blocked',
        severity: 'error',
        title: 'Merging is blocked',
        detail: 'Required reviews, checks, or branch rules are not satisfied.',
        canMerge: false,
        canBypassRequirements: true,
      };
    case 'HAS_HOOKS':
      return {
        kind: 'blocked',
        severity: 'error',
        title: 'Merging is blocked',
        detail: 'Required checks are not satisfied.',
        canMerge: false,
        canBypassRequirements: true,
      };
    case 'UNSTABLE':
      return {
        kind: 'unstable',
        severity: 'warning',
        title: 'Checks not passing',
        detail: 'Review failing checks before merging.',
        canMerge: false,
        canBypassRequirements: true,
      };
    default:
      return {
        kind: 'unknown',
        severity: 'neutral',
        title: 'Merge status unknown',
        detail: 'Refresh to try again.',
        canMerge: false,
        canBypassRequirements: false,
      };
  }
}
