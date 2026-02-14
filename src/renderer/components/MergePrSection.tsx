import { useState } from 'react';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Close as PopoverClose } from '@radix-ui/react-popover';
import { useToast } from '../hooks/use-toast';
import { ChevronDown, CheckCircle2, XCircle, AlertTriangle, GitMerge } from 'lucide-react';
import type { PrStatus } from '../lib/prStatus';
import type { CheckRunsStatus } from '../lib/checkRunStatus';

type MergeStrategy = 'squash' | 'merge' | 'rebase';

const STRATEGY_LABELS: Record<MergeStrategy, string> = {
  squash: 'Squash & Merge',
  merge: 'Merge Commit',
  rebase: 'Rebase & Merge',
};

function getMergeStateInfo(pr: PrStatus, checkRunsStatus: CheckRunsStatus | null) {
  const state = pr.mergeStateStatus?.toUpperCase();
  const isDraft = pr.isDraft;
  const prState = typeof pr.state === 'string' ? pr.state.toUpperCase() : '';

  if (prState === 'MERGED') {
    return { label: 'Pull request merged', canMerge: false, variant: 'success' as const };
  }
  if (prState === 'CLOSED') {
    return { label: 'Pull request closed', canMerge: false, variant: 'muted' as const };
  }
  if (isDraft) {
    return {
      label: 'Draft — mark as ready before merging',
      canMerge: false,
      variant: 'muted' as const,
    };
  }

  if (checkRunsStatus && !checkRunsStatus.allComplete) {
    return { label: 'Checks are still running', canMerge: true, variant: 'pending' as const };
  }

  switch (state) {
    case 'CLEAN':
      return {
        label: 'All checks passed — ready to merge',
        canMerge: true,
        variant: 'success' as const,
      };
    case 'UNSTABLE':
      return { label: 'Some checks have failed', canMerge: true, variant: 'warning' as const };
    case 'DIRTY':
      return {
        label: 'Merge conflicts must be resolved',
        canMerge: false,
        variant: 'error' as const,
      };
    case 'BLOCKED':
      return {
        label: 'Merging is blocked by branch protections',
        canMerge: false,
        variant: 'error' as const,
      };
    case 'BEHIND':
      return {
        label: 'Branch is behind the base branch',
        canMerge: true,
        variant: 'warning' as const,
      };
    default:
      if (checkRunsStatus?.hasFailures) {
        return { label: 'Some checks have failed', canMerge: true, variant: 'warning' as const };
      }
      return { label: 'Ready to merge', canMerge: true, variant: 'success' as const };
  }
}

function StatusIcon({
  variant,
}: {
  variant: 'success' | 'warning' | 'error' | 'pending' | 'muted';
}) {
  switch (variant) {
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'warning':
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'pending':
      return <Spinner size="sm" className="h-3.5 w-3.5" />;
    case 'muted':
      return <GitMerge className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

interface MergePrSectionProps {
  pr: PrStatus;
  checkRunsStatus: CheckRunsStatus | null;
  taskPath: string;
  onMerged: () => Promise<void>;
}

export function MergePrSection({ pr, checkRunsStatus, taskPath, onMerged }: MergePrSectionProps) {
  const [isMerging, setIsMerging] = useState(false);
  const [strategy, setStrategy] = useState<MergeStrategy>(() => {
    try {
      const stored = localStorage.getItem('emdash:mergeStrategy');
      if (stored === 'squash' || stored === 'merge' || stored === 'rebase') return stored;
      return 'squash';
    } catch {
      return 'squash';
    }
  });
  const { toast } = useToast();

  const prState = typeof pr.state === 'string' ? pr.state.toUpperCase() : '';
  if (prState === 'MERGED' || prState === 'CLOSED') return null;

  const stateInfo = getMergeStateInfo(pr, checkRunsStatus);

  const selectStrategy = (s: MergeStrategy) => {
    setStrategy(s);
    try {
      localStorage.setItem('emdash:mergeStrategy', s);
    } catch {
      // localStorage not available
    }
  };

  const handleMerge = async () => {
    setIsMerging(true);
    try {
      const result = await window.electronAPI.mergePr({ taskPath, strategy });
      if (result.success) {
        toast({
          title: 'Pull Request Merged',
          description: `Successfully merged via ${STRATEGY_LABELS[strategy].toLowerCase()}.`,
        });
        await onMerged();
      } else {
        toast({
          title: 'Merge Failed',
          description: result.error || 'Failed to merge pull request.',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Merge Failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <StatusIcon variant={stateInfo.variant} />
        <span className="text-xs text-muted-foreground">{stateInfo.label}</span>
      </div>
      <div className="flex min-w-0">
        <Button
          variant="default"
          size="sm"
          className="h-8 min-w-0 flex-1 truncate rounded-r-none border-r-0 px-3 text-xs"
          disabled={isMerging || !stateInfo.canMerge}
          onClick={handleMerge}
        >
          {isMerging ? (
            <Spinner size="sm" />
          ) : (
            <>
              <GitMerge className="mr-1.5 h-3.5 w-3.5" />
              {STRATEGY_LABELS[strategy]}
            </>
          )}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="default"
              size="sm"
              className="h-8 rounded-l-none border-l border-primary-foreground/20 px-1.5"
              disabled={isMerging || !stateInfo.canMerge}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto min-w-0 p-0.5">
            {(['squash', 'merge', 'rebase'] as MergeStrategy[])
              .filter((s) => s !== strategy)
              .map((s) => (
                <PopoverClose key={s} asChild>
                  <button
                    className="w-full whitespace-nowrap rounded px-2 py-1 text-left text-xs hover:bg-accent"
                    onClick={() => selectStrategy(s)}
                  >
                    {STRATEGY_LABELS[s]}
                  </button>
                </PopoverClose>
              ))}
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
