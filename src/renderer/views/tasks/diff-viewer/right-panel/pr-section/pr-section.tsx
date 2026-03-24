import {
  ArrowLeft,
  CircleDot,
  GitBranch,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import type { PullRequest, PullRequestStatus } from '@shared/pull-requests';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { SplitButton, type SplitButtonAction } from '@renderer/components/ui/split-button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@renderer/components/ui/tabs';
import { rpc } from '@renderer/core/ipc';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { cn } from '@renderer/lib/utils';
import { usePrContext } from '@renderer/views/tasks/diff-viewer/state/pr-provider';
import { PrChecksList } from './pr-checks-list';
import { PrCommitsList } from './pr-commits-list';
import { PrFilesList } from './pr-files-list';

function PullRequestStatusBadge({
  status,
  isDraft,
}: {
  status: PullRequestStatus;
  isDraft?: boolean;
}) {
  const renderIcon = () => {
    switch (status) {
      case 'open':
        return <CircleDot className="size-3" />;
      case 'closed':
        return <GitPullRequestClosed className="size-3" />;
      case 'merged':
        return <GitMerge className="size-3" />;
      default:
        return isDraft ? <GitPullRequest className="size-3" /> : <CircleDot className="size-3" />;
    }
  };

  const statusLabel = () => {
    switch (status) {
      case 'open':
        return 'Open';
      case 'closed':
        return 'Closed';
      case 'merged':
        return 'Merged';
      default:
        return isDraft ? 'Draft' : 'Open';
    }
  };

  return (
    <Badge
      variant="secondary"
      className={cn('shrink-0 gap-1', {
        'text-green-600 bg-green-50 border border-green-600': status === 'open',
        'text-red-600 bg-red-50 border border-red-600': status === 'closed',
        'text-purple-600 bg-purple-50 border border-purple-600': status === 'merged',
        'text-muted-foreground bg-muted-foreground/10 border border-muted-foreground': isDraft,
      })}
    >
      {renderIcon()}
      {statusLabel()}
    </Badge>
  );
}

type MergeMode = 'merge' | 'squash' | 'rebase';

type MergeUiState = {
  kind: 'ready' | 'draft' | 'conflicts' | 'behind' | 'blocked' | 'unstable' | 'unknown';
  title: string;
  detail?: string;
  canMerge: boolean;
};

const mergeLabels: Record<MergeMode, string> = {
  merge: 'Merge pull request',
  squash: 'Squash and merge',
  rebase: 'Rebase and merge',
};

const mergeDescriptions: Record<MergeMode, string> = {
  merge: 'All commits from this branch will be added to the base branch via a merge commit.',
  squash: 'All commits from this branch will be combined into one commit in the base branch.',
  rebase: 'All commits from this branch will be rebased and added to the base branch.',
};

function computeMergeUiState(pr: PullRequest): MergeUiState {
  if (pr.status !== 'open') {
    return { kind: 'unknown', title: 'PR is not open', canMerge: false };
  }
  if (pr.isDraft) {
    return {
      kind: 'draft',
      title: 'Draft PR',
      detail: 'Mark it ready to enable merging.',
      canMerge: false,
    };
  }
  switch (pr.metadata.mergeStateStatus) {
    case 'CLEAN':
      return { kind: 'ready', title: 'Ready to merge', canMerge: true };
    case 'DIRTY':
      return {
        kind: 'conflicts',
        title: 'Merge conflicts',
        detail: 'Resolve conflicts to enable merging.',
        canMerge: false,
      };
    case 'BEHIND':
      return {
        kind: 'behind',
        title: 'Behind base branch',
        detail: 'Update the branch before merging.',
        canMerge: false,
      };
    case 'BLOCKED':
      return {
        kind: 'blocked',
        title: 'Blocked',
        detail: 'Branch protections or approvals required.',
        canMerge: false,
      };
    case 'HAS_HOOKS':
      return {
        kind: 'blocked',
        title: 'Checks required',
        detail: 'Required checks are not satisfied yet.',
        canMerge: false,
      };
    case 'UNSTABLE':
      return {
        kind: 'unstable',
        title: 'Checks not passing',
        detail: 'Some required checks are still pending or failing.',
        canMerge: false,
      };
    default:
      return {
        kind: 'unknown',
        title: 'Merge status unknown',
        detail: 'Refresh PR status and try again.',
        canMerge: false,
      };
  }
}

const REFRESHABLE_KINDS = new Set<MergeUiState['kind']>(['unstable', 'unknown']);

function MergeObstacleBanner({
  uiState,
  onRefresh,
}: {
  uiState: MergeUiState;
  onRefresh?: () => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setIsRefreshing(true);
    try {
      onRefresh();
      await new Promise((resolve) => setTimeout(resolve, 800));
    } finally {
      setIsRefreshing(false);
    }
  };

  const showRefresh = onRefresh && REFRESHABLE_KINDS.has(uiState.kind);

  return (
    <div className="flex items-center justify-between gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-2">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-medium shrink-0">{uiState.title}</span>
        {uiState.detail && <span className="text-amber-600 truncate">{uiState.detail}</span>}
      </div>
      {showRefresh && (
        <button
          onClick={() => void handleRefresh()}
          disabled={isRefreshing}
          className="shrink-0 text-amber-600 hover:text-amber-800 disabled:opacity-40 transition-colors"
          title="Refresh PR status"
        >
          <RefreshCw className={cn('size-3', { 'animate-spin': isRefreshing })} />
        </button>
      )}
    </div>
  );
}

export function PullRequestEntry({ pr }: { pr: PullRequest }) {
  const prStatus = pr.status;
  const { mergePr, refreshPullRequest } = usePrContext();
  const showConfirm = useShowModal('confirmActionModal');
  const [isMerging, setIsMerging] = useState(false);

  const uiState = computeMergeUiState(pr);

  const doMerge = async (strategy: MergeMode) => {
    setIsMerging(true);
    try {
      await mergePr(pr.id, { strategy, commitHeadOid: pr.metadata.headRefOid });
    } finally {
      setIsMerging(false);
    }
  };

  const handleMergeClick = (strategy: MergeMode) => {
    if (uiState.canMerge) {
      void doMerge(strategy);
    } else {
      showConfirm({
        title: 'Merge anyway?',
        description: (uiState.detail ?? uiState.title) + ' Are you sure you want to proceed?',
        confirmLabel: 'Merge anyway',
        variant: 'destructive',
        onSuccess: () => void doMerge(strategy),
      });
    }
  };

  const mergeActions: SplitButtonAction[] = (['merge', 'squash', 'rebase'] as const).map(
    (strategy) => ({
      value: strategy,
      label: mergeLabels[strategy],
      description: mergeDescriptions[strategy],
      action: () => handleMergeClick(strategy),
    })
  );

  const renderPrAction = () => {
    if (prStatus !== 'open') return null;
    if (pr.isDraft) {
      return (
        <Button variant="outline" size="xs" onClick={() => {}}>
          Ready for review
        </Button>
      );
    }
    return (
      <SplitButton
        size="xs"
        disabled={!uiState.canMerge}
        variant="outline"
        loading={isMerging}
        loadingLabel="Merging..."
        icon={<GitMerge className="size-3" />}
        actions={mergeActions}
      />
    );
  };

  return (
    <div className={cn('flex flex-col gap-4 px-2 pt-1')}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 border-t pt-3 justify-between">
          <button
            className="flex gap-2 items-center min-w-0"
            onClick={() => rpc.app.openExternal(pr.url)}
          >
            <span className="flex-1 min-w-0 truncate text-md font-normal">{pr.title}</span>
            <span className="text-sm text-muted-foreground">{`#${pr.metadata.number}`}</span>
          </button>
          <div className="shrink-0 flex items-center gap-1">{renderPrAction()}</div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <PullRequestStatusBadge status={prStatus} isDraft={pr.isDraft} />
          <span className="truncate">{pr.nameWithOwner}</span>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="secondary" className="gap-1 font-mono text-xs">
              <GitBranch className="size-3" />
              {pr.metadata.baseRefName}
            </Badge>
            <ArrowLeft className="size-3" />
            <Badge variant="secondary" className="gap-1 font-mono text-xs">
              <GitBranch className="size-3" />
              {pr.metadata.headRefName}
            </Badge>
          </div>
        </div>
        {!uiState.canMerge && prStatus === 'open' && !pr.isDraft && (
          <MergeObstacleBanner uiState={uiState} onRefresh={() => refreshPullRequest(pr.id)} />
        )}
      </div>
      <div className="min-h-0">
        <Tabs defaultValue="files" className="flex flex-col min-h-0 flex-1">
          <TabsList className="w-full">
            <TabsTrigger className="text-xs font-normal" value="files">
              Files
            </TabsTrigger>
            <TabsTrigger className="text-xs font-normal" value="commits">
              Commits
            </TabsTrigger>
            <TabsTrigger className="text-xs font-normal" value="checks">
              Checks
            </TabsTrigger>
          </TabsList>
          <TabsContent value="files">
            <PrFilesList pr={pr} />
          </TabsContent>
          <TabsContent value="commits">
            <PrCommitsList />
          </TabsContent>
          <TabsContent value="checks">
            <PrChecksList nameWithOwner={pr.nameWithOwner} prNumber={pr.metadata.number} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
