import { CheckCircle2, Clock, Loader2, MinusCircle, XCircle, type LucideIcon } from 'lucide-react';
import type { AgentStatus } from '@renderer/features/tasks/conversations/conversation-manager';
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

export function agentActivityIndicatorConfig(
  status: AgentStatus | null | undefined
): StatusIndicatorConfig | null {
  switch (status) {
    case 'working':
      return {
        Icon: Loader2,
        label: 'Agent running',
        dotClass: 'bg-blue-500',
        textClass: 'text-blue-700 dark:text-blue-300',
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
