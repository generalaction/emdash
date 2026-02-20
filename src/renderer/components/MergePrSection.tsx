import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, GitMerge, XCircle } from 'lucide-react';
import type { PrStatus } from '../lib/prStatus';
import { isActivePr } from '../lib/prStatus';
import { useToast } from '../hooks/use-toast';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';

type MergeUiStateKind =
  | 'ready'
  | 'draft'
  | 'conflicts'
  | 'blocked'
  | 'unknown';

type MergeUiState = { kind: MergeUiStateKind; title: string; detail?: string; canMerge: boolean };

function computeMergeUiState(
  pr: PrStatus
): MergeUiState {
  if (pr.isDraft) {
    return {
      kind: 'draft',
      title: 'Draft PR',
      detail: 'Mark it ready to enable merging.',
      canMerge: false,
    };
  }

  const mergeState =
    typeof pr.mergeStateStatus === 'string' ? pr.mergeStateStatus.toUpperCase() : '';

  switch (mergeState) {
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
        kind: 'blocked',
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
        kind: 'blocked',
        title: 'Checks failing',
        detail: 'Fix failing checks before merging.',
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

function StatusBadge({ state }: { state: MergeUiState }) {
  switch (state.kind) {
    case 'ready':
      return (
        <Badge variant="outline">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          Ready
        </Badge>
      );
    case 'conflicts':
      return (
        <Badge variant="outline">
          <XCircle className="h-3 w-3 text-red-500" />
          Conflicts
        </Badge>
      );
    case 'draft':
      return (
        <Badge variant="outline">
          <AlertTriangle className="h-3 w-3 text-muted-foreground" />
          Draft
        </Badge>
      );
    case 'blocked':
      return (
        <Badge variant="outline">
          <AlertTriangle className="h-3 w-3 text-muted-foreground" />
          Blocked
        </Badge>
      );
    case 'unknown':
    default:
      return (
        <Badge variant="outline">
          <AlertTriangle className="h-3 w-3 text-muted-foreground" />
          Unknown
        </Badge>
      );
  }
}

export function MergePrSection({
  taskPath,
  pr,
  refreshPr,
}: {
  taskPath: string;
  pr: PrStatus | null;
  refreshPr: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [isMerging, setIsMerging] = useState(false);

  const activePr =
    pr && isActivePr(pr) && typeof pr.number === 'number' && Number.isFinite(pr.number)
      ? pr
      : null;
  const mergeUiState = activePr ? computeMergeUiState(activePr) : null;

  if (!activePr || !mergeUiState) return null;

  const doMerge = async () => {
    setIsMerging(true);
    try {
      const res = await window.electronAPI.mergePr({
        taskPath,
        prNumber: activePr.number,
        strategy: 'merge',
      });

      if (res?.success) {
        toast({
          title: 'PR merged',
          description: activePr.title ? activePr.title : `#${activePr.number}`,
        });
        await refreshPr();
      } else {
        toast({
          title: 'Merge failed',
          description: res?.error || 'Failed to merge PR.',
          variant: 'destructive',
        });
      }
    } catch {
      toast({
        title: 'Merge failed',
        description: 'An unexpected error occurred.',
        variant: 'destructive',
      });
    } finally {
      setIsMerging(false);
    }
  };

  const disabled = isMerging || !mergeUiState.canMerge;

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">Merge Pull Request</span>
            <StatusBadge state={mergeUiState} />
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{mergeUiState.title}</div>
        </div>

        <div className="flex shrink-0 items-center">
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-w-0 truncate px-2 text-xs"
            disabled={disabled}
            onClick={doMerge}
            title={disabled ? mergeUiState.title : 'Merge via GitHub'}
          >
            {isMerging ? (
              <Spinner size="sm" />
            ) : (
              <>
                <GitMerge className="mr-1.5 h-3.5 w-3.5" />
                Merge
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default MergePrSection;
