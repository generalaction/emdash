import type { PullRequestCheck } from '@emdash/plugins/pull-requests/schemas';

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
