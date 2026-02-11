import React, { useCallback } from 'react';
import { Globe, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';

export type ConnectionState =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error'
  | 'reconnecting';

interface Props {
  host?: string;
  connectionState?: ConnectionState;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onReconnect?: () => void;
  disabled?: boolean;
}

const stateConfig: Record<
  ConnectionState,
  { color: string; icon: React.ReactNode; label: string }
> = {
  connected: {
    color: 'text-muted-foreground',
    icon: <Globe className="h-full w-full" />,
    label: 'Connected',
  },
  connecting: {
    color: 'text-blue-500',
    icon: <Loader2 className="h-full w-full animate-spin" />,
    label: 'Connecting...',
  },
  reconnecting: {
    color: 'text-muted-foreground',
    icon: <RefreshCw className="h-full w-full animate-spin" />,
    label: 'Reconnecting...',
  },
  disconnected: {
    color: 'text-muted-foreground',
    icon: <Globe className="h-full w-full" />,
    label: 'Disconnected',
  },
  error: {
    color: 'text-muted-foreground',
    icon: <AlertCircle className="h-full w-full" />,
    label: 'Connection Error',
  },
};

const sizeClasses = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
};

export const RemoteProjectIndicator: React.FC<Props> = ({
  host,
  connectionState = 'disconnected',
  showLabel = false,
  size = 'sm',
  onReconnect,
  disabled = false,
}) => {
  const config = stateConfig[connectionState];
  const isDisconnected = connectionState === 'disconnected' || connectionState === 'error';

  const handleReconnect = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isDisconnected && onReconnect && !disabled) {
        onReconnect();
      }
    },
    [isDisconnected, onReconnect, disabled]
  );

  const tooltipContent = (
    <div className="space-y-1">
      <p className="font-medium">
        {config.label}
        {host && <span className="text-muted-foreground"> - {host}</span>}
      </p>
      {isDisconnected && onReconnect && (
        <p className="text-xs text-muted-foreground">Click to reconnect</p>
      )}
    </div>
  );

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1.5',
              isDisconnected && onReconnect && !disabled && 'cursor-pointer'
            )}
            onClick={handleReconnect}
            role={isDisconnected && onReconnect ? 'button' : undefined}
            tabIndex={isDisconnected && onReconnect ? 0 : undefined}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && isDisconnected && onReconnect) {
                e.preventDefault();
                onReconnect();
              }
            }}
          >
            <span className={cn(config.color, sizeClasses[size], 'flex-shrink-0')}>
              {config.icon}
            </span>
            {showLabel && <span className={cn('text-xs', config.color)}>{config.label}</span>}
            {isDisconnected && onReconnect && !disabled && (
              <RefreshCw className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="center">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
