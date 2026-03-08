import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import React from 'react';
import { cn } from '@renderer/lib/utils';

export type ConnectionState =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error'
  | 'reconnecting';

interface Props {
  state: ConnectionState;
  showIcon?: boolean;
  className?: string;
}

const stateConfig: Record<
  ConnectionState,
  {
    label: string;
    icon: React.ElementType;
    colorClass: string;
    bgClass: string;
  }
> = {
  connected: {
    label: 'Connected',
    icon: CheckCircle2,
    colorClass: 'text-emerald-600 dark:text-emerald-400',
    bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
  },
  connecting: {
    label: 'Connecting',
    icon: Loader2,
    colorClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
  },
  reconnecting: {
    label: 'Reconnecting',
    icon: Loader2,
    colorClass: 'text-amber-600 dark:text-amber-400',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
  },
  disconnected: {
    label: 'Disconnected',
    icon: Circle,
    colorClass: 'text-gray-600 dark:text-gray-400',
    bgClass: 'bg-gray-100 dark:bg-gray-800',
  },
  error: {
    label: 'Error',
    icon: XCircle,
    colorClass: 'text-red-600 dark:text-red-400',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
  },
};

export const ConnectionStatusBadge: React.FC<Props> = ({ state, showIcon = true, className }) => {
  const config = stateConfig[state];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.bgClass,
        config.colorClass,
        className
      )}
    >
      {showIcon && (
        <Icon
          className={cn(
            'h-3.5 w-3.5',
            state === 'connecting' || state === 'reconnecting' ? 'animate-spin' : ''
          )}
        />
      )}
      <span>{config.label}</span>
    </span>
  );
};

export default ConnectionStatusBadge;
