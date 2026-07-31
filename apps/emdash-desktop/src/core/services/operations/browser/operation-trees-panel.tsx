import type {
  OperationDisplayState,
  OperationTree,
  OperationTreeRollupStatus,
} from '@emdash/core/primitives/operations/api';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@core/primitives/ui/browser/button';
import { cn } from '@core/primitives/ui/browser/cn';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import { toast } from '@core/primitives/ui/browser/use-toast';

export function OperationTreesPanel({
  trees,
  retry,
  forget,
  className,
}: {
  trees: OperationTree[];
  retry(operationId: string): Promise<void>;
  forget(operationId: string): Promise<void>;
  className?: string;
}) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  if (trees.length === 0) return null;
  const attention = trees.some((tree) => treeNeedsAttention(tree));

  const runAction = async (
    action: 'retry' | 'forget',
    cleanup: OperationDisplayState
  ): Promise<void> => {
    setPendingAction(`${action}:${cleanup.operationId}`);
    try {
      await (action === 'retry' ? retry(cleanup.operationId) : forget(cleanup.operationId));
      toast({
        title: action === 'retry' ? 'Cleanup resumed' : 'Cleanup forgotten',
        description:
          action === 'retry'
            ? 'The cleanup will continue in the background.'
            : 'Emdash removed its records without deleting files on the host.',
      });
    } catch (error) {
      toast({
        title: action === 'retry' ? 'Could not resume cleanup' : 'Could not forget cleanup',
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
              />
              {tree.children.map((child) => (
                <OperationCleanupRow
                  key={child.operationId}
                  cleanup={child}
                  pendingAction={pendingAction}
                  runAction={runAction}
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

function OperationCleanupRow({
  cleanup,
  pendingAction,
  runAction,
  rollup,
  indented = false,
}: {
  cleanup: OperationDisplayState;
  pendingAction: string | null;
  runAction(action: 'retry' | 'forget', cleanup: OperationDisplayState): Promise<void>;
  rollup?: string;
  indented?: boolean;
}) {
  const retryKey = `retry:${cleanup.operationId}`;
  const forgetKey = `forget:${cleanup.operationId}`;
  const retryable = cleanupIsRetryable(cleanup);
  const forgettable = cleanupIsForgettable(cleanup);
  const confirmationReason = cleanupConfirmationReason(cleanup);
  return (
    <div className={cn('flex flex-wrap items-center gap-3 py-1', indented && 'pl-5')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">
            {operationKindLabel(cleanup.operationKind)} "{cleanup.entityName ?? cleanup.entityId}"
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
      </div>
      {(retryable || forgettable) && (
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

export function operationKindLabel(kind: string): string {
  switch (kind) {
    case 'delete-task':
      return 'Deleting task';
    case 'delete-automation':
      return 'Deleting automation';
    case 'delete-workspace':
      return 'Deleting workspace';
    case 'archive-workspace':
      return 'Archiving workspace';
    case 'delete-project':
      return 'Deleting project';
    case 'cleanup-sessions':
      return 'Cleaning up sessions';
    default:
      return 'Cleaning up';
  }
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
  }
}

export function cleanupStatusPillClass(cleanup: OperationDisplayState): string {
  switch (cleanup.status) {
    case 'queued':
    case 'running':
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
  for (const status of ROLLUP_SEVERITY) {
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

const ROLLUP_SEVERITY: readonly OperationTreeRollupStatus[] = [
  'failed',
  'awaiting-confirmation',
  'blocked-host-offline',
  'running',
  'waiting',
  'queued',
];
