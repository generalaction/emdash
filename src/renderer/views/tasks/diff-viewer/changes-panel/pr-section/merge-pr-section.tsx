import { ChevronDown, GitMerge } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { PullRequestDetails } from '../../state/use-pr-section';

type MergeMode = 'merge' | 'squash' | 'rebase';

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

const mergeWarnings: Record<string, string> = {
  BLOCKED: 'Required status checks have not passed or required reviews are missing.',
  DIRTY: 'The merge is blocked due to conflicts or other issues.',
  BEHIND: 'The head branch is behind the base branch and needs to be updated.',
  HAS_HOOKS: 'Pre-merge hooks are configured and may prevent this merge.',
  UNSTABLE: 'Some required status checks are failing.',
  UNKNOWN: 'The merge status could not be determined.',
};

interface MergePullRequestSectionProps {
  prDetails: PullRequestDetails | null;
  onMerge: (options: {
    strategy: MergeMode;
    commitHeadOid?: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

export const MergePullRequestSection = ({ prDetails, onMerge }: MergePullRequestSectionProps) => {
  const [mode, setMode] = useState<MergeMode>('merge');
  const [isMerging, setIsMerging] = useState(false);
  const showConfirm = useShowModal('confirmActionModal');

  const isClean = prDetails?.mergeStateStatus === 'CLEAN';

  const doMerge = async () => {
    setIsMerging(true);
    try {
      await onMerge({
        strategy: mode,
        commitHeadOid: prDetails?.headRefOid,
      });
    } finally {
      setIsMerging(false);
    }
  };

  const handleMergeClick = () => {
    if (isClean) {
      doMerge();
    } else {
      const status = prDetails?.mergeStateStatus ?? 'UNKNOWN';
      showConfirm({
        title: 'Merge anyway?',
        description:
          (mergeWarnings[status] ?? mergeWarnings.UNKNOWN) + ' Are you sure you want to proceed?',
        confirmLabel: 'Merge anyway',
        variant: 'destructive',
        onSuccess: () => doMerge(),
      });
    }
  };

  return (
    <div className="shrink-0 flex items-center gap-0 px-2 p-2">
      <Button
        variant="default"
        size="sm"
        className="flex-1 min-w-0 shrink rounded-r-none gap-1.5"
        onClick={handleMergeClick}
        disabled={isMerging}
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
  );
};
