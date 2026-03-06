import React from 'react';
import type { AgentStatusKind } from '@shared/agentStatus';
import { Spinner } from './ui/spinner';

export function TaskStatusIndicator({ status }: { status: AgentStatusKind }) {
  if (status === 'working') {
    return <Spinner size="sm" className="h-3 w-3 flex-shrink-0 text-muted-foreground" />;
  }

  if (status === 'waiting') {
    return <span className="h-2 w-2 flex-shrink-0 rounded-full bg-orange-500" />;
  }

  if (status === 'complete') {
    return <span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />;
  }

  if (status === 'error') {
    return <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />;
  }

  return null;
}
