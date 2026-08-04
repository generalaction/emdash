import {
  OPERATION_TREE_ROLLUP_SEVERITY,
  type OperationDisplayState,
  type OperationPrediction,
  type OperationStageDisplay,
  type OperationTree,
  type OperationTreeRollupStatus,
} from '@emdash/core/primitives/operations/api';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@core/primitives/ui/browser/button';
import { cn } from '@core/primitives/ui/browser/cn';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import { toast } from '@core/primitives/ui/browser/use-toast';

type PanelAction = 'retry' | 'forget' | 'cancel';

const ACTION_TOASTS: Record<
  PanelAction,
  { success: string; description: string; failure: string }
> = {
  retry: {
    success: 'Cleanup resumed',
    description: 'The cleanup will continue in the background.',
    failure: 'Could not resume cleanup',
  },
  forget: {
    success: 'Cleanup forgotten',
    description: 'Emdash removed its records without deleting files on the host.',
    failure: 'Could not forget cleanup',
  },
  cancel: {
    success: 'Operation cancelled',
    description: 'The queued operation will not run. Nothing was changed on the host.',
    failure: 'Could not cancel operation',
  },
};

export function OperationTreesPanel({
  trees,
  retry,
  forget,
  cancel,
  className,
}: {
  trees: OperationTree[];
  retry(operationId: string): Promise<void>;
  forget(operationId: string): Promise<void>;
  cancel?(operationId: string): Promise<void>;
  className?: string;
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  if (trees.length === 0) return null;
  const attention = trees.some((tree) => treeNeedsAttention(tree));

  const actions: Record<PanelAction, ((operationId: string) => Promise<void>) | undefined> = {
    retry,
    forget,
    cancel,
  };
  const runAction = async (action: PanelAction, cleanup: OperationDisplayState): Promise<void> => {
    const perform = actions[action];
    if (!perform) return;
    setPendingAction(`${action}:${cleanup.operationId}`);
    try {
      await perform(cleanup.operationId);
      toast({
        title: ACTION_TOASTS[action].success,
        description: ACTION_TOASTS[action].description,
      });
    } catch (error) {
      toast({
        title: ACTION_TOASTS[action].failure,
        description: error instanceof Error ? error.message : String(error),
        variant: 'destructive',
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section
      className={cn(
        'overflow-hidden rounded-md border',
        attention
          ? 'border-border-warning bg-background-warning/30'
          : 'border-border bg-background-secondary/40',
        className
      )}
    >
      <div
        className={cn(
          'flex items-start gap-2 border-b px-3 py-2',
          attention ? 'border-border-warning/50' : 'border-border'
        )}
      >
        <AlertTriangle
          className={cn(
            'mt-0.5 size-4 shrink-0',
            attention ? 'text-foreground-warning' : 'text-foreground-muted'
          )}
        />
        <div>
          <h2 className="text-sm font-medium text-foreground">Workspace operations</h2>
          <p className="text-xs text-foreground-muted">
            Cleanup operations currently running or waiting for attention.
          </p>
        </div>
      </div>
      <div
        className={cn(
          'max-h-72 divide-y overflow-y-auto',
          attention ? 'divide-border-warning/40' : 'divide-border'
        )}
      >
        {trees.map((tree) => {
          return (
            <div key={tree.root.operationId} className="space-y-1 px-3 py-2 text-xs">
              <OperationCleanupRow
                cleanup={tree.root}
                pendingAction={pendingAction}
                rollup={treeProgressLabel(tree)}
                runAction={runAction}
                cancellable={cancel !== undefined}
              />
              {tree.children.map((child) => (
                <OperationCleanupRow
                  key={child.operationId}
                  cleanup={child}
                  pendingAction={pendingAction}
                  runAction={runAction}
                  cancellable={cancel !== undefined}
                  indented
                />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function OperationStatusDetails({ operation }: { operation: OperationDisplayState }) {
  const stages = cleanupStages(operation);
  const prediction = cleanupPrediction(operation);
  if (stages) return <OperationStageRows stages={stages} />;
  if (prediction) return <OperationPredictionRows prediction={prediction} />;
  return null;
}

function OperationCleanupRow({
  cleanup,
  pendingAction,
  runAction,
  rollup,
  cancellable = false,
  indented = false,
}: {
  cleanup: OperationDisplayState;
  pendingAction: string | null;
  runAction(action: PanelAction, cleanup: OperationDisplayState): Promise<void>;
  rollup?: string;
  cancellable?: boolean;
  indented?: boolean;
}) {
  const retryKey = `retry:${cleanup.operationId}`;
  const forgetKey = `forget:${cleanup.operationId}`;
  const cancelKey = `cancel:${cleanup.operationId}`;
  const retryable = cleanupIsRetryable(cleanup);
  const forgettable = cleanupIsForgettable(cleanup);
  const showCancel = cancellable && cleanupIsCancellable(cleanup);
  const confirmationReason = cleanupConfirmationReason(cleanup);
  const prediction = cleanupPrediction(cleanup);
  const stages = cleanupStages(cleanup);
  return (
    <div className={cn('flex flex-wrap items-center gap-3 py-1', indented && 'pl-5')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">
            {cleanup.displayName} "{cleanup.entityName ?? cleanup.entityId}"
          </span>
          <span
            className={cn(
              'rounded-full border px-1.5 py-0.5 text-[10px] tracking-wide uppercase',
              cleanupStatusPillClass(cleanup)
            )}
          >
            {cleanupStatusLabel(cleanup)}
          </span>
          {rollup && <span className="text-foreground-muted">{rollup}</span>}
          <span className="text-foreground-muted">{cleanup.hostLabel ?? cleanup.hostRef}</span>
        </div>
        <div className="mt-0.5 truncate text-foreground-muted">
          {cleanup.workspacePath ?? 'No workspace path'}
          {cleanup.branchName ? ` · ${cleanup.branchName}` : ''}
          {operationStepLabel(cleanup) ? ` · ${operationStepLabel(cleanup)}` : ''}
          <span title={new Date(cleanup.createdAt).toLocaleString()}>
            {` · ${relativeQueuedTime(cleanup.createdAt)}`}
          </span>
          {cleanup.attempt > 1 ? ` · attempt ${cleanup.attempt}` : ''}
        </div>
        {confirmationReason && (
          <div className="mt-0.5 truncate text-foreground-warning">{confirmationReason}</div>
        )}
        {cleanup.error && (
          <div className="mt-0.5 truncate text-foreground-destructive">{cleanup.error}</div>
        )}
        {stages && <OperationStageRows stages={stages} />}
        {!stages && prediction && <OperationPredictionRows prediction={prediction} />}
      </div>
      {(retryable || forgettable || showCancel) && (
        <div className="flex shrink-0 items-center gap-2">
          {retryable && (
            <Button
              variant="outline"
              size="sm"
              disabled={pendingAction !== null}
              onClick={() => void runAction('retry', cleanup)}
            >
              {pendingAction === retryKey && <Spinner className="size-3.5" />}
              Clean up now
            </Button>
          )}
          {showCancel && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pendingAction !== null}
              onClick={() => void runAction('cancel', cleanup)}
            >
              {pendingAction === cancelKey && <Spinner className="size-3.5" />}
              Cancel
            </Button>
          )}
          {forgettable && (
            <Button
              variant="ghost"
              size="sm"
              disabled={pendingAction !== null}
              onClick={() => void runAction('forget', cleanup)}
            >
              {pendingAction === forgetKey && <Spinner className="size-3.5" />}
              Forget
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Live stage journal for a running or failed operation. */
function OperationStageRows({ stages }: { stages: readonly OperationStageDisplay[] }) {
  if (stages.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {stages.map((stage) => (
        <li key={stage.id} className="flex items-center gap-1.5 text-foreground-muted">
          <span className="w-3 text-center" aria-hidden>
            {stageStatusGlyph(stage.status)}
          </span>
          <span
            className={cn(
              'truncate',
              stage.status === 'failed' && 'text-foreground-destructive',
              stage.status === 'running' && 'text-foreground'
            )}
          >
            {stage.label}
          </span>
          {stage.error && (
            <span className="truncate text-foreground-destructive">— {stage.error.message}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Desktop-compiled preview for a queued host operation. Rendered dimmed with a
 * staleness caption; replaced wholesale by the host's own stage stream once
 * the operation runs.
 */
function OperationPredictionRows({ prediction }: { prediction: OperationPrediction }) {
  if (prediction.stages.length === 0) return null;
  return (
    <div className="mt-1 opacity-60">
      <ul className="space-y-0.5">
        {prediction.stages.map((stage) => (
          <li key={stage.id} className="flex items-center gap-1.5 text-foreground-muted">
            <span className="w-3 text-center" aria-hidden>
              ○
            </span>
            <span className="truncate">{stage.label}</span>
            {stage.basis === 'assumed' && <span className="text-[10px] uppercase">assumed</span>}
          </li>
        ))}
      </ul>
      <p className="mt-0.5 text-[11px] italic">{predictionCaption(prediction)}</p>
    </div>
  );
}

function predictionCaption(prediction: OperationPrediction): string {
  if (prediction.observedAsOf === null) {
    return 'Planned — the host decides what actually runs.';
  }
  return `Planned — based on what was last seen ${relativeTime(prediction.observedAsOf)}. The host decides.`;
}

function stageStatusGlyph(status: OperationStageDisplay['status']): string {
  switch (status) {
    case 'succeeded':
      return '✓';
    case 'failed':
      return '✕';
    case 'running':
      return '●';
    case 'skipped':
      return '–';
    case 'pending':
      return '○';
  }
}

function cleanupPrediction(cleanup: OperationDisplayState): OperationPrediction | undefined {
  if (
    cleanup.status === 'queued' ||
    cleanup.status === 'waiting' ||
    cleanup.status === 'blocked-host-offline'
  ) {
    return cleanup.prediction;
  }
  return undefined;
}

function cleanupStages(
  cleanup: OperationDisplayState
): readonly OperationStageDisplay[] | undefined {
  if (cleanup.status === 'running' || cleanup.status === 'failed') return cleanup.stages;
  return undefined;
}

export function cleanupIsCancellable(cleanup: OperationDisplayState): boolean {
  return (
    cleanup.status === 'queued' ||
    cleanup.status === 'waiting' ||
    cleanup.status === 'blocked-host-offline'
  );
}

export function relativeTime(timestamp: number): string {
  const elapsedMs = Math.max(0, Date.now() - timestamp);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (elapsedMs < minuteMs) return 'just now';
  if (elapsedMs < hourMs) return `${Math.floor(elapsedMs / minuteMs)} min ago`;
  if (elapsedMs < dayMs) {
    const hours = Math.floor(elapsedMs / hourMs);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

export function relativeQueuedTime(createdAt: number): string {
  return `queued ${relativeTime(createdAt)}`;
}

export function cleanupStatusLabel(cleanup: OperationDisplayState): string {
  switch (cleanup.status) {
    case 'blocked-host-offline':
      return 'Host offline';
    case 'awaiting-confirmation':
      if (cleanup.confirmationReason === 'workspace-modified') return 'Workspace modified';
      if (cleanup.confirmationReason === 'workspace-busy') return 'Workspace busy';
      return 'Needs review';
    case 'failed':
      return 'Failed';
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'waiting':
      return 'Waiting for workspace';
    case 'waiting-children':
      return 'Waiting for related cleanup';
    case 'succeeded':
      return 'Done';
  }
}

export function cleanupStatusPillClass(cleanup: OperationDisplayState): string {
  switch (cleanup.status) {
    case 'queued':
    case 'running':
    case 'succeeded':
      return 'border-border text-foreground-muted';
    case 'waiting':
    case 'waiting-children':
    case 'blocked-host-offline':
    case 'awaiting-confirmation':
      return 'border-border-warning text-foreground-warning';
    case 'failed':
      return 'border-border-destructive text-foreground-destructive';
  }
}

export function cleanupIsRetryable(cleanup: OperationDisplayState): boolean {
  return (
    cleanup.status === 'failed' ||
    cleanup.status === 'awaiting-confirmation' ||
    cleanup.status === 'blocked-host-offline'
  );
}

export function cleanupIsForgettable(cleanup: OperationDisplayState): boolean {
  return cleanupIsRetryable(cleanup) || cleanup.status === 'waiting-children';
}

export function treeNeedsAttention(tree: OperationTree): boolean {
  return (
    tree.rollup.status === 'failed' ||
    tree.rollup.status === 'awaiting-confirmation' ||
    tree.rollup.status === 'blocked-host-offline' ||
    tree.rollup.status === 'waiting'
  );
}

export function treeProgressLabel(tree: OperationTree): string | undefined {
  if (tree.rollup.total === 0) return undefined;
  return `${tree.rollup.done}/${tree.rollup.total} complete`;
}

export function worstRollupStatus(
  trees: readonly OperationTree[]
): OperationTreeRollupStatus | undefined {
  const statuses = trees.map((tree) => tree.rollup.status);
  for (const status of OPERATION_TREE_ROLLUP_SEVERITY) {
    if (statuses.includes(status)) return status;
  }
  return undefined;
}

export function operationWorkspacePaths(trees: readonly OperationTree[]): Set<string> {
  const paths = new Set<string>();
  for (const tree of trees) {
    for (const node of [tree.root, ...tree.children]) {
      if (node.workspacePath) paths.add(node.workspacePath);
    }
  }
  return paths;
}

function operationStepLabel(cleanup: OperationDisplayState): string | undefined {
  if (!cleanup.currentStep) return undefined;
  if (cleanup.totalSteps === undefined) return cleanup.currentStep;
  const completed = cleanup.completedSteps ?? 0;
  return `Step ${Math.min(completed + 1, cleanup.totalSteps)} of ${cleanup.totalSteps} - ${
    cleanup.currentStep
  }`;
}

function cleanupConfirmationReason(cleanup: OperationDisplayState): string | undefined {
  if (cleanup.status !== 'awaiting-confirmation') return undefined;
  switch (cleanup.confirmationReason) {
    case 'stale':
      return 'Request is old - confirm it is still wanted';
    case 'workspace-modified':
      return 'Worktree has uncommitted changes';
    case 'workspace-busy':
      return 'Workspace has active sessions';
    case 'reconciler-proposed':
      return 'Proposed by automatic cleanup';
  }
}
