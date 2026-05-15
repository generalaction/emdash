import type { AutomationRunStatus } from '@shared/automations/types';

export function runStatusBarClass(status: AutomationRunStatus): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-red-500';
    case 'running':
      return 'bg-blue-500';
    case 'queued':
      return 'bg-amber-500';
    case 'skipped':
      return 'bg-muted-foreground/40';
  }
}

export function isActiveStatus(status: AutomationRunStatus): boolean {
  return status === 'running' || status === 'queued';
}
