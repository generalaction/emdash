import { ToggleGroup, toast } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { cn } from '@core/primitives/styling/browser/cn';
import { type PullRequest } from '@root/src/core/services/pull-requests/api';
import { PrMergeLine } from '@root/src/core/services/pull-requests/browser/components/pr-merge-line';
import { PrCheckoutDriftLine } from './checkout-drift-line';
import { PrChecksList } from './checks-list';
import { CommitRangeCommitsList } from './commits-list';
import { PrFilesList } from './files-list';
import { type MergeAction } from './merge-footer';
import { MergeFooter } from './merge-footer';
import { computeMergeUiState } from './merge-ui-state';
import { PullRequestLinks } from './pull-request-links';
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

export const PullRequestEntry = observer(function PullRequestEntry({
  pr: cachedPr,
}: {
  pr: PullRequest;
}) {
  const taskView = useTaskComposition();
  const prStore = taskView.prStore!;
  const diffView = taskView.diffView;
  const [isMerging, setIsMerging] = useState(false);
  const [isMarkingReady, setIsMarkingReady] = useState(false);
  const [bypassRequirements, setBypassRequirements] = useState(false);
  const [isUpdatingCheckout, setIsUpdatingCheckout] = useState(false);
  const details = prStore.details;
  const pr = details?.pr ?? cachedPr;
  const checks = pr.checks;
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
        toast.error(
          bypassRequirements ? 'Failed to merge without waiting' : 'Failed to merge pull request',
          { description: result.error }
        );
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

  // Manual "Update now": guard refusals (dirty, active sessions, diverged) come
  // back as ordinary error messages through the same toast pattern merges use.
  const updateCheckout = async () => {
    setIsUpdatingCheckout(true);
    try {
      const result = await prStore.updatePrCheckout();
      if (!result.success) {
        toast.error('Could not update the checkout', { description: result.error });
      }
    } finally {
      setIsUpdatingCheckout(false);
    }
  };

  const mergeActions: MergeAction[] = (['merge', 'squash', 'rebase'] as const).map((strategy) => ({
    value: strategy,
    label: shouldBypassRequirements ? bypassMergeLabels[strategy] : mergeLabels[strategy],
    description: shouldBypassRequirements
      ? bypassMergeDescriptions[strategy]
      : mergeDescriptions[strategy],
    action: () => handleMergeClick(strategy),
  }));

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-border')}>
      <div className="flex max-h-[50%] min-h-0 w-full shrink-0 flex-col gap-2 overflow-y-auto p-2.5">
        <PullRequestLinks
          pullRequests={prStore.pullRequests.map((associatedPr) =>
            associatedPr.url === pr.url ? pr : associatedPr
          )}
        />
        <PrMergeLine pr={pr} />
        <PrCheckoutDriftLine
          drift={prStore.checkoutDrift}
          onUpdateNow={() => void updateCheckout()}
          isUpdating={isUpdatingCheckout}
        />
      </div>
      <div className="flex min-h-8 flex-1 flex-col px-2.5">
        <ToggleGroup.Root
          value={[tab]}
          className="flex w-full"
          onValueChange={([value]) => {
            if (value) {
              diffView.setPrTab(value as 'files' | 'commits' | 'checks');
            }
          }}
        >
          <ToggleGroup.Item className="flex-1" value="files" disabled={!isOpen}>
            Files
          </ToggleGroup.Item>
          <ToggleGroup.Item className="flex-1" value="commits">
            Commits
          </ToggleGroup.Item>
          <ToggleGroup.Item className="flex-1" value="checks">
            Checks
          </ToggleGroup.Item>
        </ToggleGroup.Root>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'files' && <PrFilesList pr={pr} />}
          {tab === 'commits' && <CommitRangeCommitsList range={commitRangeForPullRequest(pr)} />}
          {tab === 'checks' && <PrChecksList pr={pr} checks={checks} details={details} />}
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
                toast.error('Failed to mark pull request ready', {
                  description: 'Refresh PR status and try again.',
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
