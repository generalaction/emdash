import { useState } from 'react';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Spinner } from './ui/spinner';
import { useToast } from '../hooks/use-toast';
import { CheckCircle2, XCircle, AlertTriangle, GitMerge } from 'lucide-react';
import type { PrStatus } from '../lib/prStatus';
import type { CheckRunsStatus } from '../lib/checkRunStatus';

function getMergeStateInfo(pr: PrStatus, checkRunsStatus: CheckRunsStatus | null) {
  const state = pr.mergeStateStatus?.toUpperCase();
  const isDraft = pr.isDraft;
  const prState = typeof pr.state === 'string' ? pr.state.toUpperCase() : '';

  if (prState === 'MERGED') {
    return {
      label: 'Pull request merged',
      canMerge: false,
      isBlocked: false,
      variant: 'success' as const,
    };
  }
  if (prState === 'CLOSED') {
    return {
      label: 'Pull request closed',
      canMerge: false,
      isBlocked: false,
      variant: 'muted' as const,
    };
  }
  if (isDraft) {
    return {
      label: 'Draft — mark as ready before merging',
      canMerge: false,
      isBlocked: false,
      variant: 'muted' as const,
    };
  }

  if (checkRunsStatus && !checkRunsStatus.allComplete) {
    return {
      label: 'Checks are still running',
      canMerge: true,
      isBlocked: false,
      variant: 'pending' as const,
    };
  }

  switch (state) {
    case 'CLEAN':
      return {
        label: 'All checks passed — ready to merge',
        canMerge: true,
        isBlocked: false,
        variant: 'success' as const,
      };
    case 'UNSTABLE':
      return {
        label: 'Some checks have failed',
        canMerge: false,
        isBlocked: true,
        variant: 'warning' as const,
      };
    case 'DIRTY':
      return {
        label: 'Merge conflicts must be resolved',
        canMerge: false,
        isBlocked: false,
        variant: 'error' as const,
      };
    case 'BLOCKED':
      return {
        label: 'Merging is blocked by branch protections',
        canMerge: false,
        isBlocked: true,
        variant: 'error' as const,
      };
    case 'BEHIND':
      return {
        label: 'Branch is behind the base branch',
        canMerge: false,
        isBlocked: true,
        variant: 'warning' as const,
      };
    default:
      if (checkRunsStatus?.hasFailures) {
        return {
          label: 'Some checks have failed',
          canMerge: false,
          isBlocked: true,
          variant: 'warning' as const,
        };
      }
      return {
        label: 'Ready to merge',
        canMerge: true,
        isBlocked: false,
        variant: 'success' as const,
      };
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
  const [bypassRules, setBypassRules] = useState(false);
  const { toast } = useToast();

  const prState = typeof pr.state === 'string' ? pr.state.toUpperCase() : '';
  if (prState === 'MERGED' || prState === 'CLOSED') return null;

  const stateInfo = getMergeStateInfo(pr, checkRunsStatus);
  const canMerge = stateInfo.canMerge || (stateInfo.isBlocked && bypassRules);

  const handleMerge = async () => {
    setIsMerging(true);
    try {
      const result = await window.electronAPI.mergePr({
        taskPath,
        admin: bypassRules,
      });
      if (result.success) {
        toast({
          title: 'Pull Request Merged',
          description: 'Successfully merged the pull request.',
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
      {stateInfo.isBlocked && (
        <label className="mb-2 flex cursor-pointer items-center gap-2">
          <Checkbox
            checked={bypassRules}
            onCheckedChange={(checked) => setBypassRules(checked === true)}
            className="h-3.5 w-3.5"
          />
          <span className="text-xs text-muted-foreground">Bypass branch protections</span>
        </label>
      )}
      <Button
        variant="default"
        size="sm"
        className="h-8 w-full px-3 text-xs"
        disabled={isMerging || !canMerge}
        onClick={handleMerge}
      >
        {isMerging ? (
          <Spinner size="sm" />
        ) : (
          <>
            <GitMerge className="mr-1.5 h-3.5 w-3.5" />
            Merge Pull Request
          </>
        )}
      </Button>
    </div>
  );
}
