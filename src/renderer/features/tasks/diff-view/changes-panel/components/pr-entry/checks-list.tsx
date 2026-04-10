import { CheckCircle2, ExternalLink, Loader2, MinusCircle, XCircle } from 'lucide-react';
import type { CheckRunBucket, PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/lib/ipc';
import { formatCheckDuration, type CheckRun } from '@renderer/utils/github';
import { useCheckRuns } from '../../../state/use-check-runs';

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
      return <CheckCircle2 className="size-3.5 text-emerald-500" />;
    case 'fail':
      return <XCircle className="size-3.5 text-red-500" />;
    case 'pending':
      return <Loader2 className="size-3.5 animate-spin text-amber-500" />;
    case 'skipping':
    case 'cancel':
      return <MinusCircle className="size-3.5 text-muted-foreground/60" />;
  }
}

export function CheckRunItem({ check }: { check: CheckRun }) {
  const duration = formatCheckDuration(check.startedAt, check.completedAt);
  const subtitle = check.appName ?? check.workflowName;
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <BucketIcon bucket={check.bucket} />
      {check.appLogoUrl ? (
        <img src={check.appLogoUrl} alt={check.appName ?? ''} className="size-4 shrink-0 rounded" />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{check.name}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {duration && <span className="text-xs text-muted-foreground">{duration}</span>}
        {check.detailsUrl && (
          <button
            className="text-muted-foreground hover:text-foreground"
            title="Open in GitHub"
            onClick={() => rpc.app.openExternal(check.detailsUrl!)}
          >
            <ExternalLink className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function ChecksList({ checks, isLoading }: { checks: CheckRun[]; isLoading: boolean }) {
  const sorted = [...checks].sort((a, b) => bucketOrder[a.bucket] - bucketOrder[b.bucket]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (checks.length === 0) {
    return <div className="py-10 text-center text-xs text-muted-foreground">No checks</div>;
  }

  return (
    <div>
      {sorted.map((check, i) => (
        <CheckRunItem key={`${check.name}-${i}`} check={check} />
      ))}
    </div>
  );
}

export function PrChecksList({ pr }: { pr: PullRequest }) {
  const { checks, isLoading } = useCheckRuns(pr);
  return <ChecksList checks={checks} isLoading={isLoading} />;
}
