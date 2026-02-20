import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import type { PrStatus } from '../lib/prStatus';
import { useToast } from '../hooks/use-toast';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { Switch } from './ui/switch';

type MergeUiStateKind =
  | 'merged'
  | 'ready'
  | 'draft'
  | 'conflicts'
  | 'blocked'
  | 'unknown';

type MergeUiState = { kind: MergeUiStateKind; title: string; detail?: string; canMerge: boolean };

function computeMergeUiState(
  pr: PrStatus,
  adminOverride: boolean
): MergeUiState {
  const prState = typeof pr.state === 'string' ? pr.state.toUpperCase() : '';
  if (prState === 'MERGED') {
    return { kind: 'merged', title: 'Merged', canMerge: false };
  }

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
        detail: adminOverride ? 'Bypass enabled' : 'Branch protections or approvals required.',
        canMerge: adminOverride,
      };
    case 'HAS_HOOKS':
      return {
        kind: 'blocked',
        title: 'Checks required',
        detail: adminOverride ? 'Bypass enabled' : 'Required checks are not satisfied yet.',
        canMerge: adminOverride,
      };
    case 'UNSTABLE':
      return {
        kind: 'blocked',
        title: 'Checks failing',
        detail: adminOverride ? 'Bypass enabled' : 'Fix failing checks before merging.',
        canMerge: adminOverride,
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
    case 'merged':
      return (
        <Badge variant="outline">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          Merged
        </Badge>
      );
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
          {state.canMerge ? 'Bypass' : 'Blocked'}
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
  const [adminOverride, setAdminOverride] = useState<boolean>(() => {
    try {
      return localStorage.getItem('emdash:prMergeAdminOverride') === 'true';
    } catch {}
    return false;
  });

  const activePr =
    pr && typeof pr.number === 'number' && Number.isFinite(pr.number) ? pr : null;
  const mergeUiState = activePr ? computeMergeUiState(activePr, adminOverride) : null;
  const mergeState =
    activePr && typeof activePr.mergeStateStatus === 'string'
      ? activePr.mergeStateStatus.toUpperCase()
      : '';
  const showBypassToggle =
    mergeUiState?.kind === 'blocked' &&
    (mergeState === 'BLOCKED' || mergeState === 'HAS_HOOKS' || mergeState === 'UNSTABLE');

  if (!activePr || !mergeUiState) return null;

  const formatMergeError = (error: unknown): string => {
    if (typeof error !== 'string') return 'Failed to merge PR.';
    const lines = error
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const first = lines[0] || 'Failed to merge PR.';
    const cleaned = first.replace(/^error:\\s*/i, '').trim();
    return cleaned.length > 240 ? `${cleaned.slice(0, 237)}...` : cleaned;
  };

  const setAndPersistAdminOverride = (next: boolean) => {
    setAdminOverride(next);
    try {
      localStorage.setItem('emdash:prMergeAdminOverride', String(next));
    } catch {}
  };

  const doMerge = async () => {
    setIsMerging(true);
    try {
      const res = await window.electronAPI.mergePr({
        taskPath,
        prNumber: activePr.number,
        strategy: 'merge',
        admin: adminOverride,
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
          description: formatMergeError(res?.error),
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
  const isMerged = mergeUiState.kind === 'merged';

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="space-y-2">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">Merge Pull Request</span>
            <StatusBadge state={mergeUiState} />
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">{mergeUiState.title}</div>
        </div>
        {showBypassToggle && (
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground" title="Attempts `gh pr merge --admin`">
              {adminOverride ? 'Bypass enabled' : 'Merge without waiting'}
            </div>
            <Switch
              checked={adminOverride}
              onCheckedChange={setAndPersistAdminOverride}
              disabled={isMerging}
              aria-label="Merge without waiting"
            />
          </div>
        )}
        <Button
          variant="default"
          size="sm"
          className="h-8 w-full justify-center px-2 text-xs"
          disabled={disabled || isMerged}
          onClick={doMerge}
          title={disabled ? mergeUiState.title : 'Merge via GitHub'}
        >
          {isMerging ? (
            <Spinner size="sm" />
          ) : isMerged ? (
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Merged
            </span>
          ) : (
            'Merge pull request'
          )}
        </Button>
      </div>
    </div>
  );
}

export default MergePrSection;
