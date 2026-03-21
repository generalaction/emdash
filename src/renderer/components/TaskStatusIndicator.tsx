import React from 'react';
import type { AgentStatusKind, NotificationType } from '@shared/agentStatus';
import { Spinner } from './ui/spinner';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export function TaskStatusIndicator({
  status,
  unread = false,
  notificationType,
}: {
  status: AgentStatusKind;
  unread?: boolean;
  notificationType?: NotificationType;
}) {
  if (status === 'working') {
    return (
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
        <Spinner size="sm" className="h-4 w-4 text-muted-foreground" />
      </span>
    );
  }

  // Handle waiting status with notification type differentiation
  if (status === 'waiting') {
    // User action required: permission_prompt OR elicitation_dialog
    // Both mean "needs your attention NOW" → amber alert icon with pulse
    if (notificationType === 'permission_prompt' || notificationType === 'elicitation_dialog') {
      return (
        <span className="flex h-4 w-4 flex-shrink-0 animate-pulse items-center justify-center text-amber-500">
          <AlertTriangle className="h-4 w-4" />
        </span>
      );
    }

    // Ready/complete states: auth_success OR idle_prompt
    // Both mean "ready for next action" → green checkmark, static
    if (notificationType === 'auth_success' || notificationType === 'idle_prompt') {
      return (
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-green-500">
          <CheckCircle2 className="h-4 w-4" />
        </span>
      );
    }

    // Generic waiting without specific notification type (fallback spinner)
    if (!notificationType) {
      return (
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-muted-foreground">
          <Spinner size="sm" className="h-4 w-4" />
        </span>
      );
    }
  }

  if (unread && status === 'complete') {
    return (
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-green-500">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }

  if (unread && status === 'error') {
    return (
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-red-500">
        <AlertTriangle className="h-4 w-4" />
      </span>
    );
  }

  if (unread && status === 'idle') {
    return (
      <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-blue-500" />
      </span>
    );
  }

  return null;
}
