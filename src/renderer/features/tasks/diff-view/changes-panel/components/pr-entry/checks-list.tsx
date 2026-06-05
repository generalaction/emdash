import { CheckCircle2, ExternalLink, Loader2, MinusCircle, XCircle } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo } from 'react';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import { nextDefaultConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';
import { useEffectiveProvider } from '@renderer/features/tasks/conversations/use-effective-provider';
import { useSyncCheckRuns } from '@renderer/features/tasks/diff-view/state/use-check-runs';
import { useAgentAutoApproveDefaults } from '@renderer/features/tasks/hooks/useAgentAutoApproveDefaults';
import {
  useConversations,
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { buildPromptInjectionPayload } from '@renderer/lib/pty/prompt-injection';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import {
  computeCheckBucket,
  formatCheckDuration,
  type CheckRun,
  type CheckRunBucket,
} from '@renderer/utils/github';
import type { PullRequest, PullRequestComment } from '@shared/pull-requests';
import { CommentsList } from './comments-list';
import {
  buildPullRequestConversationItems,
  formatPullRequestCommentForAgent,
  type AddressablePullRequestComment,
} from './pull-request-conversation';
import { usePullRequestComments } from './use-pull-request-comments';

const EMPTY_COMMENTS: PullRequestComment[] = [];

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

export function CheckRunItem({ check }: { check: CheckRun }) {
  const bucket = computeCheckBucket(check);
  const duration = formatCheckDuration(
    check.startedAt ?? undefined,
    check.completedAt ?? undefined
  );
  const subtitle = check.appName ?? check.workflowName;
  const detailsUrl = check.detailsUrl;
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
        {detailsUrl && (
          <button
            type="button"
            aria-label={`Open ${check.name} check details`}
            className="absolute top-1/2 right-3 hidden -translate-y-1/2 items-center justify-center rounded bg-background-1 px-1 py-0.5 text-foreground-muted group-hover:flex hover:text-foreground"
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
    <div className="flex flex-col gap-[1px]">
      {sorted.map((check, i) => (
        <CheckRunItem key={`${check.name}-${i}`} check={check} />
      ))}
    </div>
  );
}

export const PrChecksList = observer(function PrChecksList({ pr }: { pr: PullRequest }) {
  const { projectId, taskId } = useTaskViewContext();
  const taskView = useWorkspaceViewModel();
  const conversations = useConversations();
  const connectionId = getProjectSshConnectionId(projectId);
  const { providerId, createDisabled } = useEffectiveProvider(connectionId);
  const autoApproveDefaults = useAgentAutoApproveDefaults();
  const { checks } = useSyncCheckRuns(pr);
  const commentsQuery = usePullRequestComments(pr);
  const comments = commentsQuery.data ?? EMPTY_COMMENTS;
  const conversationItems = useMemo(
    () => buildPullRequestConversationItems(pr, comments),
    [pr, comments]
  );
  const activeConversationId = taskView.tabManager.activeConversationId;
  const activeSession = activeConversationId
    ? conversations.sessions.get(activeConversationId)
    : undefined;
  const activeConversationStore = activeConversationId
    ? conversations.conversations.get(activeConversationId)
    : undefined;
  const activeSessionId = activeSession?.sessionId;

  const handleAddressInActiveChat = useCallback(
    async (comment: AddressablePullRequestComment) => {
      if (!activeSessionId) {
        toast({
          title: 'No active chat',
          description: 'Open a conversation tab before addressing a PR comment.',
          variant: 'destructive',
        });
        return;
      }

      try {
        const text = formatPullRequestCommentForAgent(pr, comment);
        const payload = buildPromptInjectionPayload({
          providerId: activeConversationStore?.data.providerId,
          text,
          forceBracketedPaste: true,
        });
        if (!payload) return;
        await rpc.pty.sendInput(activeSessionId, `${payload}\r`);
        activeSession?.pty?.terminal.focus();
        taskView.setFocusedRegion('main');
      } catch {
        toast({
          title: 'Failed to send comment',
          description: 'Try again after the chat is ready.',
          variant: 'destructive',
        });
      }
    },
    [activeConversationStore?.data.providerId, activeSession, activeSessionId, pr, taskView]
  );

  const handleAddressInNewChat = useCallback(
    async (comment: AddressablePullRequestComment) => {
      if (createDisabled || !providerId) {
        toast({
          title: 'No agent available',
          description: 'Install or select an available agent before creating a chat.',
          variant: 'destructive',
        });
        return;
      }

      const id = crypto.randomUUID();
      const title = nextDefaultConversationTitle(
        providerId,
        Array.from(conversations.conversations.values(), (conversation) => conversation.data)
      );

      try {
        await conversations.createConversation({
          id,
          projectId,
          taskId,
          provider: providerId,
          title,
          autoApprove: autoApproveDefaults.getDefault(providerId),
          initialPrompt: formatPullRequestCommentForAgent(pr, comment),
        });
        taskView.tabGroupManager.openConversation(id);
        taskView.setFocusedRegion('main');
      } catch {
        toast({
          title: 'Failed to create chat',
          description: 'Try again after the current task finishes loading.',
          variant: 'destructive',
        });
      }
    },
    [
      autoApproveDefaults,
      conversations,
      createDisabled,
      projectId,
      providerId,
      pr,
      taskId,
      taskView,
    ]
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
        <ChecksList checks={checks} />
      </section>
      <section>
        <div className="px-3 pb-1 text-[11px] font-medium text-foreground-passive uppercase">
          Comments
        </div>
        <CommentsList
          comments={conversationItems}
          isLoading={commentsQuery.isLoading}
          error={commentsQuery.error}
          onAddressInActiveChat={activeSessionId ? handleAddressInActiveChat : undefined}
          onAddressInNewChat={!createDisabled && providerId ? handleAddressInNewChat : undefined}
        />
      </section>
    </div>
  );
});
