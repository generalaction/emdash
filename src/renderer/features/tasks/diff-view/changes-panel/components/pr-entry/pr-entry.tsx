import { GitMerge, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { PullRequest } from '@shared/pull-requests';
import { PrMergeLine } from '@renderer/features/projects/components/pr-merge-line';
import { PrNumberBadge, StatusIcon } from '@renderer/features/projects/components/pr-row';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { SplitButton, type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { PrChecksList } from './checks-list';
import { PrCommitsList } from './commits-list';
import { PrFilesList } from './files-list';

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

function MergeFooter({
  uiState,
  mergeActions,
  isMerging,
  onRefresh,
  onMarkReady,
}: {
  uiState: MergeUiState;
  mergeActions: SplitButtonAction[];
  isMerging: boolean;
  onRefresh: () => void;
  onMarkReady: () => void;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      onRefresh();
      await new Promise((resolve) => setTimeout(resolve, 800));
    } finally {
      setIsRefreshing(false);
    }
  };

  const isReady = uiState.kind === 'ready';
  const isDraft = uiState.kind === 'draft';
  const showRefresh = REFRESHABLE_KINDS.has(uiState.kind);

  return (
    <div className="shrink-0 border-t border-border p-2.5 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5 min-w-0 text-xs">
        <span
          className={cn('font-medium shrink-0', isReady ? 'text-foreground' : 'text-amber-700')}
        >
          {uiState.title}
        </span>
        {uiState.detail && (
          <span className={cn('truncate', isReady ? 'text-muted-foreground' : 'text-amber-600')}>
            {uiState.detail}
          </span>
        )}
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
      <div className="shrink-0">
        {isDraft && (
          <Button variant="outline" size="xs" onClick={onMarkReady}>
            Mark ready
          </Button>
        )}
        {isReady && (
          <SplitButton
            size="xs"
            variant="outline"
            loading={isMerging}
            loadingLabel="Merging..."
            icon={<GitMerge className="size-3" />}
            actions={mergeActions}
          />
        )}
      </div>
    </div>
  );
}

export function PullRequestEntry({ pr }: { pr: PullRequest }) {
  const prStatus = pr.status;
  const prStore = useProvisionedTask().workspace.pr;
  const showConfirm = useShowModal('confirmActionModal');
  const [isMerging, setIsMerging] = useState(false);
  const [tab, setTab] = useState<'files' | 'commits' | 'checks'>('files');

  const uiState = computeMergeUiState(pr);

  const doMerge = async (strategy: MergeMode) => {
    setIsMerging(true);
    try {
      await prStore.mergePr(pr.id, { strategy, commitHeadOid: pr.metadata.headRefOid });
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

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col border-t border-border')}>
      <div className="flex flex-col gap-3 p-2.5 w-full">
        <div className="flex items-center gap-2 justify-between">
          <button
            className="flex gap-2 items-center min-w-0"
            onClick={() => rpc.app.openExternal(pr.url)}
          >
            <StatusIcon className="size-4" status={prStatus} />
            <span className="flex-1 min-w-0 truncate text-sm font-normal">{pr.title}</span>
            <PrNumberBadge number={pr.metadata.number} />
          </button>
        </div>
        <PrMergeLine pr={pr} />
      </div>
      <div className="min-h-0 flex flex-1 flex-col px-2.5">
        <ToggleGroup
          value={[tab]}
          size={'sm'}
          className="w-full"
          onValueChange={([value]) => {
            if (value) {
              setTab(value as 'files' | 'commits' | 'checks');
            }
          }}
        >
          <ToggleGroupItem className="flex-1" value="files">
            Files
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="commits">
            Commits
          </ToggleGroupItem>
          <ToggleGroupItem className="flex-1" value="checks">
            Checks
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'files' && <PrFilesList pr={pr} />}
          {tab === 'commits' && <PrCommitsList />}
          {tab === 'checks' && <PrChecksList pr={pr} />}
        </div>
      </div>
      {prStatus === 'open' && (
        <MergeFooter
          uiState={uiState}
          mergeActions={mergeActions}
          isMerging={isMerging}
          onRefresh={() => prStore.refresh(pr.id)}
          onMarkReady={() => {
            prStore.markReadyForReview(pr.id).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
