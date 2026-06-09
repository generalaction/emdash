import type { PullRequestCheck } from '@shared/core/pull-requests/pull-requests';

export type CheckRun = PullRequestCheck;

export interface CheckRunsSummary {
  total: number;
  completed: number;
  passed: number;
  failed: number;
  pending: number;
  skipped: number;
  cancelled: number;
}
