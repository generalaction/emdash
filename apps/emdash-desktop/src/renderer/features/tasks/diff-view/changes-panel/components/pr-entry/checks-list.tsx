import { CheckCircle2, ExternalLink, Loader2, MinusCircle, Wrench, XCircle } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo } from 'react';
import { useSyncCheckRuns } from '@renderer/features/tasks/diff-view/state/use-check-runs';
import {
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import {
  computeCheckBucket,
  formatCheckDuration,
  type CheckRun,
  type CheckRunBucket,
} from '@renderer/utils/github';
import type { PullRequest, PullRequestComment } from '@shared/core/pull-requests/pull-requests';
import { CommentsList } from './comments-list';
import { buildPullRequestConversationItems } from './pull-request-conversation';
import { usePullRequestComments } from './use-pull-request-comments';

const EMPTY_COMMENTS: PullRequestComment[] = [];

const bucketOrder: Record<CheckRunBucket, number> = {
  fail: 0,
  pending: 1,
  pass: 2,
  skipping: 3,
  cancel: 4,
};

function buildFixCheckPrompt(check: CheckRun, pr: PullRequest): string {
  const bucket = computeCheckBucket(check);
  const lines = [
    'Investigate and fix this pull request check.',
    '',
    `PR: ${pr.title}`,
    `PR URL: ${pr.url}`,
    `Head SHA: ${pr.headRefOid}`,
    '',
    `Check: ${check.name}`,
    `Status: ${check.status ?? 'unknown'}`,
    `Conclusion: ${check.conclusion ?? 'unknown'}`,
    `Result bucket: ${bucket}`,
  ];

  if (check.workflowName) lines.push(`Workflow: ${check.workflowName}`);
  if (check.appName) lines.push(`App: ${check.appName}`);
  if (check.detailsUrl) lines.push(`Details URL: ${check.detailsUrl}`);

  lines.push(
    '',
    'Open the details URL if needed, reproduce the failure locally when possible, implement the smallest safe fix, and run the relevant validation before reporting back.'
  );

  return lines.join('\n');
}

export function BucketIcon({ bucket }: { bucket: CheckRunBucket }) {
  switch (bucket) {
    case 'pass':
      return <CheckCircle2 className="size-3.5 shrink-0 text-foreground-success" />;
    case 'fail':
      return <XCircle className="size-3.5 shrink-0 text-foreground-destructive" />;
    case 'pending':
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-foreground-warning" />;
    case 'skipping':
    case 'cancel':
      return <MinusCircle className="size-3.5 shrink-0 text-foreground-muted" />;
  }
}

export const CheckRunItem = observer(function CheckRunItem({
  check,
  pr,
}: {
  check: CheckRun;
  pr: PullRequest;
}) {
  const { projectId, taskId } = useTaskViewContext();
  const taskView = useWorkspaceViewModel();
  const showCreateConversationModal = useShowModal('createConversationModal');
  const bucket = computeCheckBucket(check);
  const duration = formatCheckDuration(
    check.startedAt ?? undefined,
    check.completedAt ?? undefined
  );
  const subtitle = check.appName ?? check.workflowName;
  const detailsUrl = check.detailsUrl;
  const canShowFixAction = bucket === 'fail';

  const handleFixCheck = useCallback(() => {
    showCreateConversationModal({
      projectId,
      taskId,
      initialPrompt: buildFixCheckPrompt(check, pr),
      onSuccess: ({ conversationId }) => {
        taskView.paneLayout.open('conversation', { conversationId }, { preview: false });
      },
    });
  }, [showCreateConversationModal, projectId, taskId, check, pr, taskView]);

  return (
    <div className="group relative flex items-center gap-2 rounded-md px-3 py-2 hover:bg-background-1">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
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
          <div className="flex w-full justify-start truncate text-xs text-foreground-passive">
            {subtitle}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {duration && <span className="text-xs text-foreground-passive">{duration}</span>}
        <div className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-0.5 rounded bg-background-1 px-0.5 group-hover:flex">
          {canShowFixAction && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Fix ${check.name} check with a new conversation`}
                    className="flex size-6 items-center justify-center rounded text-foreground-muted hover:bg-background-2 hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleFixCheck();
                    }}
                  >
                    <Wrench className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>Fix check in a new conversation</TooltipContent>
            </Tooltip>
          )}
          {detailsUrl && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`Open ${check.name} check details`}
                    className="flex size-6 items-center justify-center rounded text-foreground-muted hover:bg-background-2 hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      void rpc.app.openExternal(detailsUrl);
                    }}
                  >
                    <ExternalLink className="size-3.5" />
                  </button>
                }
              />
              <TooltipContent>Open check details</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
});

export function ChecksList({ checks, pr }: { checks: CheckRun[]; pr: PullRequest }) {
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
    <div className="flex flex-col gap-[1px]">
      {sorted.map((check, i) => (
        <CheckRunItem key={`${check.name}-${i}`} check={check} pr={pr} />
      ))}
    </div>
  );
}

export const PrChecksList = observer(function PrChecksList({
  projectId,
  pr,
}: {
  projectId: string;
  pr: PullRequest;
}) {
  const { checks } = useSyncCheckRuns(projectId, pr);
  const commentsQuery = usePullRequestComments(projectId, pr);
  const comments = commentsQuery.data ?? EMPTY_COMMENTS;
  const conversationItems = useMemo(
    () => buildPullRequestConversationItems(pr, comments),
    [pr, comments]
  );

  if (checks.length === 0 && conversationItems.length === 0 && !commentsQuery.isLoading) {
    return <EmptyState label="No checks or comments" description="Nothing available yet" />;
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <section>
        <div className="px-3 pb-1 text-[11px] font-medium text-foreground-passive uppercase">
          Checks
        </div>
        <ChecksList checks={checks} pr={pr} />
      </section>
      <section>
        <div className="px-3 pb-1 text-[11px] font-medium text-foreground-passive uppercase">
          Comments
        </div>
        <CommentsList
          comments={conversationItems}
          isLoading={commentsQuery.isLoading}
          error={commentsQuery.error}
        />
      </section>
    </div>
  );
});
