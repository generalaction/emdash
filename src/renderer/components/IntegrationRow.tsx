import React from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';

type IntegrationStatus =
  | 'connected'
  | 'disconnected'
  | 'loading'
  | 'error'
  | 'missing'
  | 'needs_key';

interface IntegrationRowProps {
  logoSrc?: string;
  icon?: React.ReactNode;
  name: string;
  onNameClick?: () => void;
  status: IntegrationStatus;
  statusLabel?: string;
  accountLabel?: string;
  middle?: React.ReactNode;
  onConnect?: () => void;
  connectDisabled?: boolean;
  connectContent?: React.ReactNode;
  onDisconnect?: () => void;
  onOpen?: () => void;
  rightExtra?: React.ReactNode;
  showStatusPill?: boolean;
}

const STATUS_CLASSES: Record<IntegrationStatus, string> = {
  connected:
    'border border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  loading: 'border border-border/60 bg-transparent text-muted-foreground',
  error: 'border border-border/60 bg-transparent text-muted-foreground',
  disconnected: 'border border-border/60 bg-transparent text-muted-foreground',
  missing: 'border border-border/60 bg-transparent text-muted-foreground',
  needs_key: 'border border-border/60 bg-transparent text-muted-foreground',
};

const STATUS_LABELS: Record<IntegrationStatus, string> = {
  connected: 'Connected',
  loading: 'Connecting…',
  error: 'Not connected',
  disconnected: 'Not connected',
  missing: 'Not connected',
  needs_key: 'Not connected',
};

const BUTTON_BASE =
  'inline-flex h-8 min-w-[2.5rem] items-center justify-center rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-60';

const ICON_BUTTON =
  'rounded-md p-1.5 text-muted-foreground transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

const ICON_WRAPPER =
  'flex h-6 w-6 items-center justify-center rounded-md bg-muted/40 backdrop-blur-sm text-muted-foreground';

const IntegrationRow: React.FC<IntegrationRowProps> = ({
  logoSrc,
  icon,
  name,
  onNameClick,
  status,
  statusLabel,
  accountLabel,
  middle,
  onConnect,
  connectDisabled,
  connectContent,
  onDisconnect,
  onOpen,
  rightExtra,
  showStatusPill = true,
}) => {
  const resolvedStatus = STATUS_CLASSES[status] ? status : 'disconnected';
  const showConnect = resolvedStatus !== 'connected' && status !== 'loading' && !!onConnect;
  const showDisconnect = resolvedStatus === 'connected' && !!onDisconnect;
  const showOpen = resolvedStatus === 'connected' && !!onOpen;

  const resolvedStatusLabel = statusLabel ?? STATUS_LABELS[status] ?? STATUS_LABELS.disconnected;

  const defaultMiddle =
    status === 'connected' && accountLabel ? (
      <span className="truncate text-sm text-muted-foreground">{accountLabel}</span>
    ) : null;

  const avatar = (
    <span className={ICON_WRAPPER}>
      {logoSrc ? (
        <img src={logoSrc} alt="" className="h-5 w-5 object-contain" />
      ) : icon ? (
        icon
      ) : null}
    </span>
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/40">
      <div className="flex items-center gap-3">
        {avatar}
        {onNameClick ? (
          <button
            type="button"
            onClick={onNameClick}
            className="group flex items-center gap-1 text-sm font-medium text-foreground transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span>{name}</span>
            <span className="text-xs text-muted-foreground transition group-hover:text-foreground/80">
              ↗
            </span>
          </button>
        ) : (
          <span className="text-sm font-medium text-foreground">{name}</span>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
        <div className="min-w-0">{middle ?? defaultMiddle}</div>
        {showStatusPill ? (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[resolvedStatus] ?? STATUS_CLASSES.disconnected}`}
          >
            {resolvedStatusLabel}
          </span>
        ) : null}

        {rightExtra}

        {showOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className={ICON_BUTTON}
            aria-label={`Open ${name} settings`}
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}

        {showDisconnect ? (
          <button
            type="button"
            onClick={onDisconnect}
            className={ICON_BUTTON}
            aria-label={`Disconnect ${name}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}

        {showConnect ? (
          <button
            type="button"
            onClick={onConnect}
            className={BUTTON_BASE}
            disabled={connectDisabled}
          >
            {connectContent ?? 'Connect'}
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default IntegrationRow;
