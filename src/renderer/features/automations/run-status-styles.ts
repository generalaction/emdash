import { CheckCircle2, Clock, Loader2, MinusCircle, XCircle, type LucideIcon } from 'lucide-react';
import type { AgentStatus } from '@renderer/features/tasks/conversations/conversation-manager';
import type { AutomationRunStatus } from '@shared/automations/automation-run';

export interface StatusIndicatorConfig {
  Icon: LucideIcon;
  label: string;
  dotClass: string;
  textClass: string;
  spin?: boolean;
}

export function statusIndicatorConfig(status: AutomationRunStatus): StatusIndicatorConfig {
  switch (status) {
    case 'scheduled':
      return {
        Icon: Clock,
        label: 'Scheduled',
        dotClass: 'bg-background-info',
        textClass: 'text-foreground-info',
      };
    case 'queued':
      return {
        Icon: Clock,
        label: 'Queued',
        dotClass: 'bg-background-info',
        textClass: 'text-foreground-info',
      };
    case 'creating_task':
      return {
        Icon: Loader2,
        label: 'Creating task',
        dotClass: 'bg-background-info',
        textClass: 'text-foreground-info',
        spin: true,
      };
    case 'launching_task':
      return {
        Icon: Loader2,
        label: 'Launching task',
        dotClass: 'bg-background-info',
        textClass: 'text-foreground-info',
        spin: true,
      };
    case 'creating_conversation':
      return {
        Icon: Loader2,
        label: 'Starting agent',
        dotClass: 'bg-background-info',
        textClass: 'text-foreground-info',
        spin: true,
      };
    case 'done':
      return {
        Icon: CheckCircle2,
        label: 'Done',
        dotClass: 'bg-background-success',
        textClass: 'text-foreground-success',
      };
    case 'failed':
      return {
        Icon: XCircle,
        label: 'Failed',
        dotClass: 'bg-background-error',
        textClass: 'text-foreground-error',
      };
    case 'skipped':
      return {
        Icon: MinusCircle,
        label: 'Skipped',
        dotClass: 'bg-background-3',
        textClass: 'text-foreground-muted',
      };
  }
}

export function isActiveStatus(status: AutomationRunStatus): boolean {
  return (
    status === 'queued' ||
    status === 'creating_task' ||
    status === 'launching_task' ||
    status === 'creating_conversation'
  );
}

export function agentActivityIndicatorConfig(
  status: AgentStatus | null | undefined
): StatusIndicatorConfig | null {
  switch (status) {
    case 'working':
      return {
        Icon: Loader2,
        label: 'Running',
        dotClass: 'bg-muted-foreground/60',
        textClass: 'text-muted-foreground',
        spin: true,
      };
    case 'awaiting-input':
      return {
        Icon: Clock,
        label: 'Needs input',
        dotClass: 'bg-amber-500',
        textClass: 'text-amber-700 dark:text-amber-300',
      };
    case 'error':
      return {
        Icon: XCircle,
        label: 'Agent error',
        dotClass: 'bg-destructive',
        textClass: 'text-destructive',
      };
    case 'completed':
      return {
        Icon: CheckCircle2,
        label: 'Agent complete',
        dotClass: 'bg-emerald-500',
        textClass: 'text-emerald-700 dark:text-emerald-300',
      };
    case 'idle':
    case null:
    case undefined:
      return null;
  }
}

export function activeAgentActivityIndicatorConfig(
  status: AgentStatus | null | undefined
): StatusIndicatorConfig | null {
  if (status !== 'working' && status !== 'awaiting-input') return null;
  return agentActivityIndicatorConfig(status);
}
