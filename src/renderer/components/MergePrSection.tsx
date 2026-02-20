import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, GitMerge, Loader2, XCircle } from 'lucide-react';
import type { CheckRunsStatus } from '../lib/checkRunStatus';
import type { PrStatus } from '../lib/prStatus';
import { isActivePr } from '../lib/prStatus';
import { useToast } from '../hooks/use-toast';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Close as PopoverClose } from '@radix-ui/react-popover';
import { Spinner } from './ui/spinner';
import { Switch } from './ui/switch';

type MergeStrategy = 'squash' | 'merge' | 'rebase';

const STRATEGY_LABELS: Record<MergeStrategy, string> = {
  squash: 'Squash',
  merge: 'Merge commit',
  rebase: 'Rebase',
};

const STRATEGY_DESCRIPTIONS: Record<MergeStrategy, string> = {
  squash: 'Combine all commits into one.',
  merge: 'Preserve commit history with a merge commit.',
  rebase: 'Rebase commits onto the base branch.',
};

type MergeUiStateKind =
  | 'ready'
  | 'draft'
  | 'checks_pending'
  | 'checks_failed'
  | 'conflicts'
  | 'blocked'
  | 'unknown';

type MergeUiState = { kind: MergeUiStateKind; title: string; detail?: string; canMerge: boolean };

function computeMergeUiState(
  pr: PrStatus,
  checkRunsStatus: CheckRunsStatus | null,
  adminOverride: boolean
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

  // GitHub mergeability is the source of truth; checks are shown as supporting context.
  const base: MergeUiState = (() => {
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
          detail: adminOverride
            ? 'Admin override enabled — merge may still fail.'
            : 'Branch protections or approvals required.',
          canMerge: adminOverride,
        };
      case 'HAS_HOOKS':
        return {
          kind: 'blocked',
          title: 'Checks required',
          detail: adminOverride
            ? 'Admin override enabled — merge may still fail.'
            : 'Required checks are not satisfied yet.',
          canMerge: adminOverride,
        };
      case 'UNSTABLE':
        return {
          kind: 'checks_failed',
          title: 'Checks failing',
          detail: adminOverride
            ? 'Admin override enabled — merge may still fail.'
            : 'Fix failing checks before merging.',
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
  })();

  const pending = checkRunsStatus?.summary?.pending ?? 0;
  const failed = checkRunsStatus?.summary?.failed ?? 0;

  if (base.kind === 'ready' && pending > 0) {
    return {
      kind: 'checks_pending',
      title: 'Checks running',
      detail: 'Checks are still running (may be optional).',
      canMerge: base.canMerge,
    };
  }

  if ((base.kind === 'ready' || base.kind === 'blocked') && failed > 0) {
    return {
      kind: 'checks_failed',
      title: 'Checks failing',
      detail: adminOverride
        ? 'Admin override enabled — merge may still fail.'
        : 'Some checks are failing.',
      canMerge: base.canMerge,
    };
  }

  return base;
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
    case 'checks_pending':
      return (
        <Badge variant="outline">
          <Loader2 className="h-3 w-3 animate-spin" />
          Pending
        </Badge>
      );
    case 'checks_failed':
      return (
        <Badge variant="outline">
          <XCircle className="h-3 w-3 text-red-500" />
          Failing
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
  checkRunsStatus,
  refreshPr,
}: {
  taskPath: string;
  pr: PrStatus | null;
  checkRunsStatus: CheckRunsStatus | null;
  refreshPr: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [isMerging, setIsMerging] = useState(false);
  const [strategy, setStrategy] = useState<MergeStrategy>(() => {
    try {
      const stored = localStorage.getItem('emdash:prMergeStrategy');
      if (stored === 'squash' || stored === 'merge' || stored === 'rebase') return stored;
    } catch {}
    return 'squash';
  });
  const [adminOverride, setAdminOverride] = useState<boolean>(() => {
    try {
      return localStorage.getItem('emdash:prMergeAdminOverride') === 'true';
    } catch {}
    return false;
  });

  const activePr =
    pr && isActivePr(pr) && typeof pr.number === 'number' && Number.isFinite(pr.number) ? pr : null;
  const mergeUiState = useMemo(
    () => (activePr ? computeMergeUiState(activePr, checkRunsStatus, adminOverride) : null),
    [activePr, checkRunsStatus, adminOverride]
  );

  if (!activePr || !mergeUiState) return null;

  const setAndPersistStrategy = (next: MergeStrategy) => {
    setStrategy(next);
    try {
      localStorage.setItem('emdash:prMergeStrategy', next);
    } catch {}
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
        strategy,
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
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{mergeUiState.title}</span>
            {mergeUiState.detail ? ` • ${mergeUiState.detail}` : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          <div className="flex min-w-0">
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-w-0 truncate rounded-r-none border-r-0 px-2 text-xs"
              disabled={disabled}
              onClick={doMerge}
              title={disabled ? mergeUiState.title : `Merge using: ${STRATEGY_LABELS[strategy]}`}
            >
              {isMerging ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <GitMerge className="mr-1.5 h-3.5 w-3.5" />
                  Merge ({STRATEGY_LABELS[strategy]})
                </>
              )}
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-l-none px-1.5"
                  disabled={isMerging}
                  title="Select merge strategy"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-1">
                {(Object.keys(STRATEGY_LABELS) as MergeStrategy[]).map((s) => (
                  <PopoverClose key={s} asChild>
                    <button
                      type="button"
                      className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${
                        s === strategy ? 'bg-accent' : ''
                      }`}
                      onClick={() => setAndPersistStrategy(s)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{STRATEGY_LABELS[s]}</span>
                        {s === strategy && (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {STRATEGY_DESCRIPTIONS[s]}
                      </div>
                    </button>
                  </PopoverClose>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">Admin override</div>
          <div className="text-[11px] text-muted-foreground">
            Attempts `gh pr merge --admin` (requires GitHub admin; may still fail).
          </div>
        </div>
        <Switch
          checked={adminOverride}
          onCheckedChange={setAndPersistAdminOverride}
          disabled={isMerging}
          aria-label="Admin override"
        />
      </div>
    </div>
  );
}

export default MergePrSection;
