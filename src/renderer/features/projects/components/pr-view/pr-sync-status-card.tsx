import { AlertCircle, CheckCircle2, Loader2, RotateCcw, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { ReactNode, useEffect, useState } from 'react';
import { getPrSyncStore } from '@renderer/features/projects/stores/project-selectors';
import { ListPopoverCard } from '@renderer/lib/components/list-popover-card';
import { Button } from '@renderer/lib/ui/button';

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
  separator?: boolean;
  className?: string;
}

function SyncStatusCard({
  icon,
  label,
  content,
  actions,
  separator = false,
  className,
}: SyncStatusCardProps) {
  return (
    <ListPopoverCard className={className}>
      {icon}
      {label && <span className="text-foreground-muted shrink-0">{label}</span>}
      {separator && label && <span className="text-muted-foreground">·</span>}
      <span className="text-foreground-passive grow">{content}</span>
      {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
    </ListPopoverCard>
  );
}

interface Props {
  projectId: string;
  repositoryUrl: string;
}

export const PrSyncStatusCard = observer(function PrSyncStatusCard({
  projectId,
  repositoryUrl,
}: Props) {
  const prSync = getPrSyncStore(projectId);
  const state = prSync?.getState(repositoryUrl);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (state?.status === 'done') {
      setShowSuccess(true);
      const timer = setTimeout(() => {
        setShowSuccess(false);
        prSync?.clear(repositoryUrl);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [state?.status, prSync, repositoryUrl]);

  if (showSuccess) {
    return (
      <SyncStatusCard
        icon={<CheckCircle2 className="size-3.5 shrink-0 text-green-500" />}
        content="Sync complete"
      />
    );
  }

  if (!state || state.status === 'done') return null;

  const kindLabel = KIND_LABELS[state.kind] ?? state.kind;

  if (state.status === 'running' && state.kind !== 'single') {
    const hasProgress = state.total != null && state.total > 0;
    return (
      <SyncStatusCard
        icon={<Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
        label={kindLabel}
        content={
          hasProgress ? `Syncing PRs: ${state.synced ?? 0} / ${state.total}` : 'Syncing PRs…'
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 h-6 px-2 text-xs"
            onClick={() => prSync?.cancel(repositoryUrl)}
          >
            Cancel
          </Button>
        }
      />
    );
  }

  if (state.status === 'cancelled' && state.kind !== 'single') {
    return (
      <SyncStatusCard
        icon={<RotateCcw className="size-3.5 shrink-0 text-muted-foreground" />}
        label={kindLabel}
        separator
        content="Sync cancelled"
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => prSync?.retry()}
          >
            Resume
          </Button>
        }
      />
    );
  }

  // error state
  return (
    <SyncStatusCard
      className="border-destructive/40 bg-destructive/5"
      icon={<AlertCircle className="size-3.5 shrink-0 text-destructive" />}
      label={<span className="text-destructive font-medium">Sync failed</span>}
      separator
      content={
        <span className="truncate" title={state.error}>
          {state.error ?? 'Unknown error'}
        </span>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => prSync?.retry()}
          >
            Retry
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => prSync?.clear(repositoryUrl)}
            aria-label="Dismiss"
          >
            <X className="size-3.5" />
          </Button>
        </>
      }
    />
  );
});
