import type { CheckRun, CheckRunsSummary } from './types';

export function computeCheckRunsSummary(checks: CheckRun[]): CheckRunsSummary {
  const summary: CheckRunsSummary = {
    total: checks.length,
    completed: 0,
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
  summary.completed = summary.total - summary.pending;
  return summary;
}

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  if (isNaN(date)) return '';
  const diffMs = now - date;
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function formatCheckDuration(startedAt?: string, completedAt?: string): string | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (isNaN(start) || isNaN(end)) return null;
  const diffMs = end - start;
  if (diffMs < 0) return null;

  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${totalSeconds % 60}s`;
  return '<1m';
}
