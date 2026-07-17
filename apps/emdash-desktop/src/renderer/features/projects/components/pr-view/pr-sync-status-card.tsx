import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, type ReactNode } from 'react';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { Button } from '@renderer/lib/ui/button';
import { pullRequestErrorMessage } from '@root/src/core/services/pull-requests/api';
import { usePullRequestsStore } from '@root/src/core/services/pull-requests/browser';

const KIND_LABELS: Record<string, string> = {
  full: 'Full sync',
  incremental: 'Incremental sync',
  single: 'Single PR',
};

interface SyncStatusCardProps {
  icon: ReactNode;
  label?: ReactNode;
  content: ReactNode;
  actions?: ReactNode;
  className?: string;
}

function SyncStatusCard({ icon, label, content, actions, className }: SyncStatusCardProps) {
  return (
    <ListPopoverCard className={className}>
      {icon}
      {label && <span className="shrink-0 text-foreground-muted">{label}</span>}

      <span className="min-w-0 grow text-foreground-passive">{content}</span>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </ListPopoverCard>
  );
}

function SyncErrorStatusCard({
  error,
  actions,
}: {
  error: string | null | undefined;
  actions?: ReactNode;
}) {
  return (
    <SyncStatusCard
      className={'border-border-destructive bg-background-destructive text-foreground-destructive'}
      icon={<AlertCircle className="size-3.5 shrink-0 text-foreground-destructive" />}
      label={<span className="font-medium text-foreground-destructive">Sync failed</span>}
      content={
        <span className="block truncate text-foreground-destructive/80" title={error ?? undefined}>
          {error ?? 'Unknown error'}
        </span>
      }
      actions={actions}
    />
  );
}

interface Props {
  repositoryUrl: string;
  manualError?: string | null;
}

export const PrSyncStatusCard = observer(function PrSyncStatusCard({
  repositoryUrl,
  manualError,
}: Props) {
  const store = usePullRequestsStore();
  const state = store.syncState(repositoryUrl);
  const [showSuccess, setShowSuccess] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  useEffect(() => {
    if (state?.phase === 'idle' && state.lastSyncedAt !== undefined) {
      setShowSuccess(true);
      const timer = setTimeout(() => setShowSuccess(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [state?.lastSyncedAt, state?.phase]);

  if (manualError && (!state || state.phase === 'idle')) {
    return <SyncErrorStatusCard error={manualError} />;
  }

  if (showSuccess) {
    return (
      <SyncStatusCard
        icon={<CheckCircle2 className="size-3.5 shrink-0 text-green-500" />}
        content="Sync complete"
      />
    );
  }

  if (!state || state.phase === 'idle') return null;

  const kindLabel = state.kind ? (KIND_LABELS[state.kind] ?? state.kind) : undefined;

  if (state.phase === 'running' && state.kind !== 'single') {
    const hasProgress = state.total != null && state.total > 0;
    return (
      <SyncStatusCard
        icon={<Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />}
        label={kindLabel}
        content={
          hasProgress ? `Syncing PRs: ${state.synced ?? 0} / ${state.total}` : 'Syncing PRs…'
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => store.cancelSync(repositoryUrl)}
          >
            Cancel
          </Button>
        }
      />
    );
  }

  const error = state.error ? pullRequestErrorMessage(state.error) : 'Unknown error';
  if (dismissedError === error) return null;
  return (
    <SyncErrorStatusCard
      error={error}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => store.sync(repositoryUrl)}
          >
            Retry
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setDismissedError(error)}
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </Button>
        </>
      }
    />
  );
});
