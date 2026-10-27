import type { LinkedType } from './use-create-task-state';

export type CreateTaskStrategy = 'from-branch' | 'from-issue' | 'from-pull-request';

/** Choose the initial link type only; users can still change the link and workspace settings. */
export function createTaskModalDefaults(
  strategy: CreateTaskStrategy | undefined,
  availability: { hasIssues: boolean; hasPullRequests: boolean }
): { linkedType: LinkedType } {
  switch (strategy) {
    case 'from-branch':
      return { linkedType: null };
    case 'from-issue':
      return { linkedType: 'issue' };
    case 'from-pull-request':
      return { linkedType: 'pr' };
    case undefined:
      return {
        linkedType: availability.hasIssues ? 'issue' : availability.hasPullRequests ? 'pr' : null,
      };
  }
}
