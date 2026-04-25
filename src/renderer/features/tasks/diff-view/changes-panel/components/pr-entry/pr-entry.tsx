import { ExternalLink } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { getPrNumber, type PullRequest } from '@shared/pull-requests';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { PrMergeLine } from '@renderer/lib/components/pr-merge-line';
import { PrNumberBadge } from '@renderer/lib/components/pr-number-badge';
import { StatusIcon } from '@renderer/lib/components/pr-status-icon';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { SplitButtonAction } from '@renderer/lib/ui/split-button';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { PrChecksList } from './checks-list';
import { PrCommitsList } from './commits-list';
import { PrFilesList } from './files-list';
import { MergeFooter } from './merge-footer';

export type MergeMode = 'merge' | 'squash' | 'rebase';

export type MergeSeverity = 'success' | 'warning' | 'error' | 'neutral';

export type MergeUiState = {
  kind: 'ready' | 'draft' | 'conflicts' | 'behind' | 'blocked' | 'unstable' | 'unknown';
  severity: MergeSeverity;
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
    return {
      kind: 'unknown',
      severity: 'neutral',
      title: 'Merge status unknown',
      detail: 'Refresh PR status and try again.',
      canMerge: false,
    };
  }
  if (pr.isDraft) {
    return {
      kind: 'draft',
      severity: 'neutral',
      title: 'Draft pull request',
      detail: 'Mark ready for review to enable merging.',
      canMerge: false,
    };
  }
  switch (pr.mergeStateStatus) {
    case 'CLEAN':
      return {
        kind: 'ready',
        severity: 'success',
        title: 'Ready to merge',
        detail: 'No conflicts or required reviews.',
        canMerge: true,
      };
    case 'DIRTY':
      return {
        kind: 'conflicts',
        severity: 'error',
        title: 'Merge conflicts',
        detail: 'Resolve conflicts before merging.',
        canMerge: false,
      };
    case 'BEHIND':
      return {
        kind: 'behind',
        severity: 'warning',
        title: 'Branch is out-of-date',
        detail: 'Update branch before merging.',
        canMerge: false,
      };
    case 'BLOCKED':
      return {
        kind: 'blocked',
        severity: 'error',
        title: 'Merging is blocked',
        detail: 'Required reviews or branch protections not satisfied.',
        canMerge: false,
      };
    case 'HAS_HOOKS':
      return {
        kind: 'blocked',
        severity: 'error',
        title: 'Merging is blocked',
        detail: 'Required checks are not satisfied.',
        canMerge: false,
      };
    case 'UNSTABLE':
      return {
        kind: 'unstable',
        severity: 'warning',
        title: 'Checks not passing',
        detail: 'Review failing checks before merging.',
        canMerge: false,
      };
    default:
      return {
        kind: 'unknown',
        severity: 'neutral',
        title: 'Merge status unknown',
        detail: 'Refresh to try again.',
        canMerge: false,
      };
  }
}

export const PullRequestEntry = observer(function PullRequestEntry({ pr }: { pr: PullRequest }) {
  const task = useProvisionedTask();
  const prStatus = pr.status;
  const prStore = task.workspace.pr;
  const diffView = task.taskView.diffView;
  const showConfirm = useShowModal('confirmActionModal');
  const [isMerging, setIsMerging] = useState(false);
  const tab = diffView.effectivePrTab;
  const isOpen = pr.status === 'open';

  const uiState = computeMergeUiState(pr);

  const doMerge = async (strategy: MergeMode) => {
    setIsMerging(true);
    try {
      await prStore.mergePr(pr.url, { strategy, commitHeadOid: pr.headRefOid });
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
      <div className="flex flex-col gap-2 p-2.5 w-full">
        <div className="flex items-center gap-2 justify-between">
          <button
            className="relative flex gap-2 items-center min-w-0 group"
            onClick={() => rpc.app.openExternal(pr.url)}
          >
            <StatusIcon className="size-4" status={prStatus} />
            <span className="flex-1 min-w-0 truncate text-sm font-normal">{pr.title}</span>
            <PrNumberBadge number={getPrNumber(pr) ?? 0} />
            <span className="absolute right-0 flex items-center pl-4 pr-0.5 bg-linear-to-r from-transparent to-background opacity-0 group-hover:opacity-100 transition-opacity">
              <ExternalLink className="size-3.5 text-foreground-muted" />
            </span>
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
              diffView.setPrTab(value as 'files' | 'commits' | 'checks');
            }
          }}
        >
          <ToggleGroupItem className="flex-1" value="files" disabled={!isOpen}>
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
      {pr.status === 'open' && (
        <MergeFooter
          uiState={uiState}
          mergeActions={mergeActions}
          isMerging={isMerging}
          onRefresh={() => prStore.refresh(pr.url)}
          onMarkReady={() => {
            prStore.markReadyForReview(pr.url).catch(() => {});
          }}
        />
      )}
    </div>
  );
});
