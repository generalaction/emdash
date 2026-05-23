import { CheckCircle2, Clock, Loader2, MinusCircle, XCircle, type LucideIcon } from 'lucide-react';
import type { AutomationRunStatus } from '@shared/automations/types';

export interface StatusIndicatorConfig {
  Icon: LucideIcon;
  label: string;
  dotClass: string;
  textClass: string;
  spin?: boolean;
}

export function statusIndicatorConfig(status: AutomationRunStatus): StatusIndicatorConfig {
  switch (status) {
    case 'success':
      return {
        Icon: CheckCircle2,
        label: 'Success',
        dotClass: 'bg-emerald-500',
        textClass: 'text-emerald-700 dark:text-emerald-300',
      };
    case 'failed':
      return {
        Icon: XCircle,
        label: 'Failed',
        dotClass: 'bg-destructive',
        textClass: 'text-destructive',
      };
    case 'running':
      return {
        Icon: Loader2,
        label: 'Running',
        dotClass: 'bg-blue-500',
        textClass: 'text-blue-700 dark:text-blue-300',
        spin: true,
      };
    case 'queued':
      return {
        Icon: Clock,
        label: 'Queued',
        dotClass: 'bg-amber-500',
        textClass: 'text-amber-700 dark:text-amber-300',
      };
    case 'skipped':
      return {
        Icon: MinusCircle,
        label: 'Skipped',
        dotClass: 'bg-muted-foreground/50',
        textClass: 'text-muted-foreground',
      };
  }
}

export function isActiveStatus(status: AutomationRunStatus): boolean {
  return status === 'running' || status === 'queued';
}
