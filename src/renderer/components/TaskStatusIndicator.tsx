import React from 'react';
import type { AgentStatusKind } from '@shared/agentStatus';
import { Spinner } from './ui/spinner';

export function TaskStatusIndicator({
  status,
  unread = false,
}: {
  status: AgentStatusKind;
  unread?: boolean;
}) {
  if (status === 'working') {
    return (
      <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
        <Spinner size="sm" className="h-3 w-3 text-muted-foreground" />
      </span>
    );
  }

  if (unread && (status === 'waiting' || status === 'complete' || status === 'error')) {
    return (
      <span className="flex h-3 w-3 flex-shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-blue-500" />
      </span>
    );
  }

  return null;
}
