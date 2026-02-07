export type CheckRunBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

export interface CheckRun {
  name: string;
  state: string;
  bucket: CheckRunBucket;
  description?: string;
  link?: string;
  workflow?: string;
  event?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CheckRunsSummary {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  skipped: number;
  cancelled: number;
}

export interface CheckRunsStatus {
  checks: CheckRun[];
  summary: CheckRunsSummary;
  allComplete: boolean;
  hasFailures: boolean;
}

export function computeCheckRunsSummary(checks: CheckRun[]): CheckRunsSummary {
  const summary: CheckRunsSummary = {
    total: checks.length,
    passed: 0,
    failed: 0,
    pending: 0,
    skipped: 0,
    cancelled: 0,
  };
  for (const c of checks) {
    switch (c.bucket) {
      case 'pass':
        summary.passed++;
        break;
      case 'fail':
        summary.failed++;
        break;
      case 'pending':
        summary.pending++;
        break;
      case 'skipping':
        summary.skipped++;
        break;
      case 'cancel':
        summary.cancelled++;
        break;
    }
  }
  return summary;
}

export function buildCheckRunsStatus(checks: CheckRun[]): CheckRunsStatus {
  const summary = computeCheckRunsSummary(checks);
  return {
    checks,
    summary,
    allComplete: summary.pending === 0,
    hasFailures: summary.failed > 0,
  };
}

export function formatCheckDuration(
  startedAt?: string,
  completedAt?: string
): string | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  const diffMs = end - start;
  if (diffMs < 0) return null;

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
