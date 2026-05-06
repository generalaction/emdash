import type { PullRequestCheck } from '@shared/pull-requests';

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
