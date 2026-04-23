import { CheckCircle2, ExternalLink, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { PullRequest } from '@shared/pull-requests';
import { useCheckRuns } from '@renderer/features/tasks/diff-view/state/use-check-runs';
import { rpc } from '@renderer/lib/ipc';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import {
  computeCheckBucket,
  formatCheckDuration,
  type CheckRun,
  type CheckRunBucket,
} from '@renderer/utils/github';

const bucketOrder: Record<CheckRunBucket, number> = {
  fail: 0,
  pending: 1,
  pass: 2,
  skipping: 3,
  cancel: 4,
};

export function BucketIcon({ bucket }: { bucket: CheckRunBucket }) {
  switch (bucket) {
    case 'pass':
      return <CheckCircle2 className="size-3.5 text-green-500" />;
    case 'fail':
      return <XCircle className="size-3.5 text-foreground-destructive" />;
    case 'pending':
      return <Loader2 className="size-3.5 animate-spin text-amber-500" />;
    case 'skipping':
    case 'cancel':
      return <MinusCircle className="size-3.5 text-foreground-muted" />;
  }
}

export function CheckRunItem({ check }: { check: CheckRun }) {
  const bucket = computeCheckBucket(check);
  const duration = formatCheckDuration(
    check.startedAt ?? undefined,
    check.completedAt ?? undefined
  );
  const subtitle = check.appName ?? check.workflowName;
  return (
    <button
      className="group relative flex items-center gap-2 px-3 py-2 hover:bg-background-1 rounded-md"
      onClick={() => rpc.app.openExternal(check.detailsUrl!)}
    >
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <BucketIcon bucket={bucket} />
          <div className="truncate text-sm">{check.name}</div>
          {check.appLogoUrl ? (
            <img
              src={check.appLogoUrl}
              alt={check.appName ?? ''}
              className="size-4 shrink-0 rounded opacity-60"
            />
          ) : null}
        </div>
        {subtitle && (
          <div className="truncate text-xs text-foreground-passive w-full justify-start flex">
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {duration && <span className="text-xs text-foreground-passive">{duration}</span>}
        {check.detailsUrl && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center bg-background-1 text-foreground-muted hover:text-foreground rounded px-1 py-0.5">
            <ExternalLink className="size-3.5" />
          </div>
        )}
      </div>
    </button>
  );
}

export function ChecksList({ checks, isLoading }: { checks: CheckRun[]; isLoading: boolean }) {
  const sorted = [...checks].sort(
    (a, b) => bucketOrder[computeCheckBucket(a)] - bucketOrder[computeCheckBucket(b)]
  );
  const hasChecks = checks.length > 0;
  const shouldShowLoading = !hasChecks && isLoading;

  if (shouldShowLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!hasChecks) {
    return <EmptyState label="No checks" description="No checks available" />;
  }

  return (
    <div className="flex flex-col gap-[1px] py-2">
      {sorted.map((check, i) => (
        <CheckRunItem key={`${check.name}-${i}`} check={check} />
      ))}
    </div>
  );
}

export const PrChecksList = observer(function PrChecksList({ pr }: { pr: PullRequest }) {
  const { checks, isLoading } = useCheckRuns(pr);
  return <ChecksList checks={checks} isLoading={isLoading} />;
});
