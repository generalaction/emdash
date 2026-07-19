import { ExternalLink } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTaskViewContext } from '@core/features/tasks/browser/task-view-context';
import { useTaskComposition } from '@core/features/workbench/browser/task-composition-context';
import { PrMergeLine } from '@renderer/lib/components/pr-merge-line';
import { PrNumberBadge } from '@renderer/lib/components/pr-number-badge';
import { StatusIcon } from '@renderer/lib/components/pr-status-icon';
import { PrUrlCopyButton } from '@renderer/lib/components/pr-url-copy-button';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';
import { getPrNumber, type PullRequest } from '@root/src/core/services/pull-requests/api';
import { PrChecksList } from './checks-list';
import { CommitRangeCommitsList } from './commits-list';
import { PrFilesList } from './files-list';
import { MergeFooter } from './merge-footer';
import { computeMergeUiState } from './merge-ui-state';
import { commitRangeForPullRequest } from './use-commits';

export type MergeMode = 'merge' | 'squash' | 'rebase';

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

const bypassMergeLabels: Record<MergeMode, string> = {
  merge: 'Bypass rules and merge',
  squash: 'Squash without waiting',
  rebase: 'Rebase without waiting',
};

const bypassMergeDescriptions: Record<MergeMode, string> = {
  merge: 'Bypass unmet requirements and add all commits via a merge commit.',
  squash: 'Bypass unmet requirements and combine all commits into one commit.',
  rebase: 'Bypass unmet requirements and rebase all commits onto the base branch.',
};

export const PullRequestEntry = observer(function PullRequestEntry({ pr }: { pr: PullRequest }) {
  const { projectId } = useTaskViewContext();
  const taskView = useTaskComposition();
  const prStore = taskView.prStore!;
  const diffView = taskView.diffView;
  const [isMerging, setIsMerging] = useState(false);
  const [isMarkingReady, setIsMarkingReady] = useState(false);
  const [bypassRequirements, setBypassRequirements] = useState(false);
  if (!diffView) return null;
  const tab = diffView.effectivePrTab;
  const isOpen = pr.status === 'open';

  const uiState = computeMergeUiState(pr);
  const shouldBypassRequirements = uiState.canBypassRequirements && bypassRequirements;

  const doMerge = async (strategy: MergeMode, bypassRequirements: boolean) => {
    setIsMerging(true);
    try {
      const result = await prStore.mergePr(pr.url, {
        strategy,
        commitHeadOid: pr.headRefOid,
        bypassRequirements,
      });
      if (!result.success) {
        toast({
          title: bypassRequirements
            ? 'Failed to merge without waiting'
            : 'Failed to merge pull request',
          description: result.error,
          variant: 'destructive',
        });
      }
    } finally {
      setIsMerging(false);
    }
  };

  const handleMergeClick = (strategy: MergeMode) => {
    if (uiState.canMerge) {
      void doMerge(strategy, false);
    } else if (shouldBypassRequirements) {
      void doMerge(strategy, true);
    }
  };

  const mergeActions: SplitButtonAction[] = (['merge', 'squash', 'rebase'] as const).map(
    (strategy) => ({
      value: strategy,
      label: shouldBypassRequirements ? bypassMergeLabels[strategy] : mergeLabels[strategy],
      description: shouldBypassRequirements
        ? bypassMergeDescriptions[strategy]
        : mergeDescriptions[strategy],
      action: () => handleMergeClick(strategy),
    })
  );

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col border-t border-border')}>
      <div className="flex w-full flex-col gap-2 p-2.5">
        <div className="group/header flex items-center justify-between gap-2">
          <button
            className="group relative flex min-w-0 flex-1 items-center gap-2"
            onClick={() => rpc.app.openExternal(pr.url)}
          >
            <StatusIcon className="size-4" pr={pr} />
            <span className="min-w-0 flex-1 truncate text-sm font-normal">{pr.title}</span>
            <div className="transition-opacity duration-200 group-hover:opacity-0">
              <PrNumberBadge number={getPrNumber(pr) ?? 0} />
            </div>
            <span className="absolute right-0 flex items-center bg-linear-to-r from-transparent to-background pr-0.5 pl-4 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <ExternalLink className="size-3.5 text-foreground-muted" />
            </span>
          </button>
          <PrUrlCopyButton
            url={pr.url}
            className="opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
          />
        </div>
        <PrMergeLine pr={pr} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-2.5">
        <ToggleGroup
          value={[tab]}
          size={'xs'}
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
          {tab === 'commits' && <CommitRangeCommitsList range={commitRangeForPullRequest(pr)} />}
          {tab === 'checks' && <PrChecksList projectId={projectId} pr={pr} />}
        </div>
      </div>
      {pr.status === 'open' && (
        <MergeFooter
          uiState={uiState}
          mergeActions={mergeActions}
          isMerging={isMerging}
          isMarkingReady={isMarkingReady}
          bypassRequirements={bypassRequirements}
          onMarkReady={() => {
            setIsMarkingReady(true);
            prStore
              .markReadyForReview(pr.url)
              .catch(() => {
                toast({
                  title: 'Failed to mark pull request ready',
                  description: 'Refresh PR status and try again.',
                  variant: 'destructive',
                });
              })
              .finally(() => setIsMarkingReady(false));
          }}
          onBypassRequirementsChange={setBypassRequirements}
        />
      )}
    </div>
  );
});
