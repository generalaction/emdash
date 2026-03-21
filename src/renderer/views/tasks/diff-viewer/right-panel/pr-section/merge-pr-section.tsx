import { ChevronDown, GitMerge } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Badge } from '@renderer/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import type { PullRequestDetails } from '@renderer/lib/github';

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

function computeMergeUiState(pr: PullRequestDetails): MergeUiState {
  if (pr.isDraft) {
    return {
      kind: 'draft',
      title: 'Draft PR',
      detail: 'Mark it ready to enable merging.',
      canMerge: false,
    };
  }

  switch (pr.mergeStateStatus) {
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

interface MergePullRequestSectionProps {
  prDetails: PullRequestDetails | null;
  onMerge: (options: {
    strategy: MergeMode;
    commitHeadOid?: string;
  }) => Promise<{ success: true } | { success: false; error: string }>;
}

export const MergePullRequestSection = ({ prDetails, onMerge }: MergePullRequestSectionProps) => {
  const [mode, setMode] = useState<MergeMode>('merge');
  const [isMerging, setIsMerging] = useState(false);
  const showConfirm = useShowModal('confirmActionModal');

  if (!prDetails) return null;

  const uiState = computeMergeUiState(prDetails);

  const doMerge = async () => {
    setIsMerging(true);
    try {
      await onMerge({ strategy: mode, commitHeadOid: prDetails.headRefOid });
    } finally {
      setIsMerging(false);
    }
  };

  const handleMergeClick = () => {
    if (uiState.canMerge) {
      doMerge();
    } else {
      showConfirm({
        title: 'Merge anyway?',
        description: (uiState.detail ?? uiState.title) + ' Are you sure you want to proceed?',
        confirmLabel: 'Merge anyway',
        variant: 'destructive',
        onSuccess: () => doMerge(),
      });
    }
  };

  return (
    <div className="shrink-0 flex flex-col gap-1.5 px-2 pb-2">
      <div className="flex items-center gap-0">
        <Button
          variant="default"
          size="sm"
          className="flex-1 min-w-0 shrink rounded-r-none gap-1.5"
          onClick={handleMergeClick}
          disabled={isMerging || uiState.kind === 'draft'}
          title={uiState.kind === 'draft' ? uiState.detail : undefined}
        >
          <GitMerge className="size-3.5" />
          {isMerging ? 'Merging...' : mergeLabels[mode]}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="default"
                size="sm"
                className="rounded-l-none border-l border-primary-foreground/20 px-1.5"
                disabled={isMerging}
              />
            }
          >
            <ChevronDown className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {(['merge', 'squash', 'rebase'] as const).map((value) => (
              <DropdownMenuItem
                key={value}
                onClick={() => setMode(value)}
                className="flex-col items-start gap-0.5 py-2"
              >
                <span className="font-medium">{mergeLabels[value]}</span>
                <span className="text-xs text-muted-foreground whitespace-normal">
                  {mergeDescriptions[value]}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {uiState.kind === 'draft' && (
        <Badge variant="outline" className="w-full justify-center text-xs text-muted-foreground">
          {uiState.detail}
        </Badge>
      )}
      {uiState.kind === 'conflicts' && (
        <Badge variant="outline" className="w-full justify-center text-xs text-muted-foreground">
          Resolve merge conflicts before merging
        </Badge>
      )}
    </div>
  );
};
