import React, { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, XCircle } from 'lucide-react';
import type { PrStatus } from '../lib/prStatus';
import { useToast } from '../hooks/use-toast';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Spinner } from './ui/spinner';
import { Switch } from './ui/switch';
import { Close as PopoverClose } from '@radix-ui/react-popover';

type MergeUiStateKind =
  | 'merged'
  | 'ready'
  | 'draft'
  | 'conflicts'
  | 'blocked'
  | 'unknown';

type MergeUiState = { kind: MergeUiStateKind; title: string; detail?: string; canMerge: boolean };

type MergeStrategy = 'merge' | 'squash' | 'rebase';

const MERGE_STRATEGIES: Array<{
  id: MergeStrategy;
  title: string;
  description: string;
}> = [
  {
    id: 'merge',
    title: 'Create a merge commit',
    description: 'All commits from this branch will be added to the base branch via a merge commit.',
  },
  {
    id: 'squash',
    title: 'Squash and merge',
    description: 'All commits from this branch will be combined into one commit in the base branch.',
  },
  {
    id: 'rebase',
    title: 'Rebase and merge',
    description: 'All commits from this branch will be rebased and added to the base branch.',
  },
];

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
  const [strategy, setStrategy] = useState<MergeStrategy>(() => {
    try {
      const stored = localStorage.getItem('emdash:prMergeStrategy');
      if (stored === 'merge' || stored === 'squash' || stored === 'rebase') return stored;
    } catch {}
    return 'merge';
  });
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

  const setAndPersistStrategy = (next: MergeStrategy) => {
    setStrategy(next);
    try {
      localStorage.setItem('emdash:prMergeStrategy', next);
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
  const showDisabledTooltip = !isMerged && !isMerging && !mergeUiState.canMerge;
  const disabledTooltipText = `Disabled because ${mergeUiState.detail || mergeUiState.title}.`;

  return (
    <div className="border-t border-border px-4 py-3">
      <div className="space-y-2">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-foreground">Merge Pull Request</span>
            <StatusBadge state={mergeUiState} />
          </div>
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
        {isMerged ? (
          <Button
            variant="default"
            size="sm"
            className="h-8 w-full justify-center px-2 text-xs disabled:opacity-100"
            disabled
          >
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Merged
            </span>
          </Button>
        ) : (
          <div className="flex w-full min-w-0">
            {showDisabledTooltip ? (
              <TooltipProvider delayDuration={120}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="min-w-0 flex-1">
                      <Button
                        variant="default"
                        size="sm"
                        className="h-8 w-full justify-center rounded-r-none px-2 text-xs disabled:opacity-100"
                        disabled
                      >
                        Merge pull request
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">{disabledTooltipText}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="h-8 min-w-0 flex-1 justify-center rounded-r-none px-2 text-xs disabled:opacity-100"
                disabled={disabled}
                onClick={doMerge}
                title={disabled ? mergeUiState.title : 'Merge via GitHub'}
              >
                {isMerging ? <Spinner size="sm" /> : 'Merge pull request'}
              </Button>
            )}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 w-10 shrink-0 rounded-l-none px-0 disabled:opacity-100"
                  disabled={isMerging}
                  title="Select merge method"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-1">
                {MERGE_STRATEGIES.map((opt) => (
                  <PopoverClose key={opt.id} asChild>
                    <button
                      type="button"
                      className="w-full rounded px-2 py-2 text-left hover:bg-accent"
                      onClick={() => setAndPersistStrategy(opt.id)}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center">
                          {strategy === opt.id ? (
                            <Check className="h-4 w-4 text-foreground" />
                          ) : null}
                        </span>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground">{opt.title}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {opt.description}
                          </div>
                        </div>
                      </div>
                    </button>
                  </PopoverClose>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        )}
        {mergeUiState.kind === 'conflicts' && (
          <div>
            <Badge variant="outline" className="w-full justify-center text-xs text-muted-foreground">
              Resolve merge conflicts before merging
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}

export default MergePrSection;
