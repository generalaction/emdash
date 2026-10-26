import type { LinkedType } from './use-create-task-state';

export type CreateTaskStrategy = 'from-branch' | 'from-issue' | 'from-pull-request';

/** Choose the initial view only; users can still change the link and workspace settings. */
export function createTaskModalDefaults(
  strategy: CreateTaskStrategy | undefined,
  availability: { hasIssues: boolean; hasPullRequests: boolean }
): { linkedType: LinkedType; tab: 'conversation' | 'workspace' } {
  switch (strategy) {
    case 'from-branch':
      return { linkedType: null, tab: 'workspace' };
    case 'from-issue':
      return { linkedType: 'issue', tab: 'conversation' };
    case 'from-pull-request':
      return { linkedType: 'pr', tab: 'conversation' };
    case undefined:
      return {
        linkedType: availability.hasIssues ? 'issue' : availability.hasPullRequests ? 'pr' : null,
        tab: 'conversation',
      };
  }
}
