import { CheckCircle2, ExternalLink, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { useSyncCheckRuns } from '@renderer/features/tasks/diff-view/state/use-check-runs';
import { rpc } from '@renderer/lib/ipc';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import {
  computeCheckBucket,
  formatCheckDuration,
  type CheckRun,
  type CheckRunBucket,
} from '@renderer/utils/github';
import { CommentsList } from './comments-list';
import { usePullRequestComments } from './use-pull-request-comments';

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
      return <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />;
    case 'fail':
      return <XCircle className="size-3.5 text-foreground-destructive shrink-0" />;
    case 'pending':
      return <Loader2 className="size-3.5 animate-spin text-amber-500 shrink-0" />;
    case 'skipping':
    case 'cancel':
      return <MinusCircle className="size-3.5 text-foreground-muted shrink-0" />;
  }
}

export function CheckRunItem({ check }: { check: CheckRun }) {
  const bucket = computeCheckBucket(check);
  const duration = formatCheckDuration(
    check.startedAt ?? undefined,
    check.completedAt ?? undefined
  );
  const subtitle = check.appName ?? check.workflowName;
  const detailsUrl = check.detailsUrl;
  return (
    <div className="group relative flex items-center gap-2 px-3 py-2 hover:bg-background-1 rounded-md">
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
        {detailsUrl && (
          <button
            type="button"
            aria-label={`Open ${check.name} check details`}
            className="absolute right-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center justify-center bg-background-1 text-foreground-muted hover:text-foreground rounded px-1 py-0.5"
            onClick={() => void rpc.app.openExternal(detailsUrl)}
          >
            <ExternalLink className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function ChecksList({ checks }: { checks: CheckRun[] }) {
  const sorted = useMemo(
    () =>
      [...checks].sort(
        (a, b) => bucketOrder[computeCheckBucket(a)] - bucketOrder[computeCheckBucket(b)]
      ),
    [checks]
  );

  if (sorted.length === 0) {
    return <div className="px-3 py-2 text-xs text-foreground-passive">No checks available</div>;
  }

  return (
    <div className="flex flex-col gap-[1px] py-2">
      {sorted.map((check) => (
        <CheckRunItem
          key={`${check.name}-${check.detailsUrl ?? check.startedAt ?? check.completedAt ?? ''}`}
          check={check}
        />
      ))}
    </div>
  );
}

export const PrChecksList = observer(function PrChecksList({ pr }: { pr: PullRequest }) {
  const { checks } = useSyncCheckRuns(pr);
  const commentsQuery = usePullRequestComments(pr);
  const comments = commentsQuery.data ?? [];

  if (checks.length === 0 && comments.length === 0 && !commentsQuery.isLoading) {
    return <EmptyState label="No checks or comments" description="Nothing available yet" />;
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <section>
        <div className="px-3 pb-1 text-[11px] font-medium uppercase text-foreground-passive">
          Checks
        </div>
        <ChecksList checks={checks} />
      </section>
      <section>
        <div className="px-3 pb-1 text-[11px] font-medium uppercase text-foreground-passive">
          Comments
        </div>
        <CommentsList
          comments={comments}
          isLoading={commentsQuery.isLoading}
          error={commentsQuery.error}
        />
      </section>
    </div>
  );
});
