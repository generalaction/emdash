import { ScriptStatus, type ScriptStatusKind } from '@emdash/ui/react/components';
import { Popover, Spinner, toast } from '@emdash/ui/react/primitives';
import { Activity, RotateCcw } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import {
  asMounted,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import {
  useTaskComposition,
  useWorkspace,
} from '@core/features/workbench/api/browser/task-composition-context';
import {
  getLifecycleScriptsClient,
  getWorkspaceRegistryWireClient,
} from '@core/features/workspaces/api/browser/client';
import { lifecycleScriptsStoreToken } from '@core/features/workspaces/contributions/browser/workspace-stores';
import { projectHostRef } from '@core/primitives/projects/api';
import { cn } from '@core/primitives/styling/browser/cn';
import type { WorkspaceLifecycleStepInfo } from '@core/primitives/tasks/api';
import { createLifecycleScriptTerminalId } from '@core/primitives/terminals/api';
import { LIFECYCLE_STEP_TITLES } from '@core/primitives/workspaces/api';

/**
 * The workspace lifecycle timeline (spec: workspace-lifecycle-v2, Activity badge):
 * one titlebar badge replacing the background pill and the script pill. Spinner
 * while any step runs, error emphasis when one failed, a quiet badge once
 * everything settled — the popover lists every recorded step with the shared
 * script-status icon, derived copy, and relative dates.
 */

type ScriptStepId = 'prepare' | 'setup' | 'run' | 'teardown';

const SCRIPT_STEP_IDS: ReadonlySet<WorkspaceLifecycleStepInfo['id']> = new Set([
  'prepare',
  'setup',
  'run',
  'teardown',
]);

const STATUS_ICONS: Record<
  Exclude<WorkspaceLifecycleStepInfo['status'], 'skipped'>,
  ScriptStatusKind
> = {
  pending: 'waiting',
  running: 'in-progress',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'cancelled',
};

function stepDescription(step: WorkspaceLifecycleStepInfo): string {
  const params = step.params;
  switch (step.id) {
    case 'adopt-worktree':
      return `Worktree with ${params.branch} already exists at ${params.path}`;
    case 'fetch-branch':
      return `Fetching ${params.source} into ${params.branch}`;
    case 'fetch-remote-base':
      return `Fetch remote base ${params.base}`;
    case 'configure-branch':
      return `Configuring upstream tracking for ${params.branch}`;
    case 'create-worktree': {
      // While the step is still running, whether the branch is new is unknown.
      const branchKind =
        params.branchCreated === undefined
          ? ''
          : params.branchCreated
            ? 'newly created '
            : 'existing ';
      return `Adding worktree at ${params.path} using ${branchKind}branch ${params.branch}`;
    }
    case 'copy-artifacts':
      return typeof params.fileCount === 'number'
        ? `Copying ${params.fileCount} artifacts defined in preservePatterns`
        : 'Copying artifacts defined in preservePatterns';
    case 'push-branch':
      return typeof params.remote === 'string'
        ? `Pushing ${params.branch} to ${params.remote}`
        : `Pushing ${params.branch} to remote`;
    case 'prepare':
      return 'Running prepare scripts';
    case 'setup':
      return 'Running setup scripts';
    case 'run':
      return 'Starting run scripts';
    case 'teardown':
      return 'Running teardown scripts';
    case 'fetch-refs':
      return '';
  }
}

/** Run shows when it started (it keeps running); everything else when it finished. */
function stepTimestamp(step: WorkspaceLifecycleStepInfo): number | null {
  return step.id === 'run' ? step.startedAt : step.finishedAt;
}

function relativeLabel(timestamp: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export type ActivityBadgeViewProps = {
  steps: WorkspaceLifecycleStepInfo[];
  onOpenScript: (script: ScriptStepId) => void;
  onRetryPush: () => void;
  isRetryingPush?: boolean;
  /** Starts a fresh manual run with provenance 'retry' — the drawer's play button's mechanism. */
  onRetryScript: (script: ScriptStepId) => void;
  retryingScript?: ScriptStepId | null;
  /** Test seam: relative labels are pure given a fixed now. */
  now?: number;
};

export function ActivityBadgeView({
  steps,
  onOpenScript,
  onRetryPush,
  isRetryingPush = false,
  onRetryScript,
  retryingScript = null,
  now = Date.now(),
}: ActivityBadgeViewProps) {
  // fetch-refs is durable but advisory — never displayed; skipped steps are hidden.
  const visible = steps.filter(
    (
      step
    ): step is WorkspaceLifecycleStepInfo & {
      status: Exclude<WorkspaceLifecycleStepInfo['status'], 'skipped'>;
    } => step.id !== 'fetch-refs' && step.status !== 'skipped'
  );
  if (visible.length === 0) return null;

  const running = visible.some((step) => step.status === 'running' || step.status === 'pending');
  const failed = visible.some((step) => step.status === 'failed');
  const state = running ? 'running' : failed ? 'failed' : 'settled';

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Workspace activity"
        data-activity-state={state}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs transition-colors',
          failed && !running
            ? 'bg-background-destructive text-foreground-destructive hover:bg-destructive/20'
            : 'bg-background-secondary text-foreground-muted hover:text-foreground'
        )}
      >
        {running ? <Spinner size="sm" /> : <Activity className="size-3 shrink-0" />}
        <span>Activity</span>
      </Popover.Trigger>
      <Popover.Content align="end" className="flex w-80 flex-col gap-0.5 p-2">
        {visible.map((step) => {
          const icon = <ScriptStatus status={STATUS_ICONS[step.status]} size={14} />;
          const timestamp = stepTimestamp(step);
          const body = (
            <>
              {icon}
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {LIFECYCLE_STEP_TITLES[step.id]}
                  </span>
                  {timestamp !== null && (
                    <span className="shrink-0 text-[11px] text-foreground-passive">
                      {relativeLabel(timestamp, now)}
                    </span>
                  )}
                </span>
                <span className="w-full truncate text-left text-[11px] text-foreground-muted">
                  {stepDescription(step)}
                </span>
                {step.status === 'failed' && step.message ? (
                  <span className="w-full truncate text-left text-[11px] text-foreground-destructive">
                    {step.message}
                  </span>
                ) : null}
                {step.status === 'cancelled' && step.message ? (
                  <span className="w-full truncate text-left text-[11px] text-foreground-passive">
                    {step.message}
                  </span>
                ) : null}
              </span>
            </>
          );
          if (SCRIPT_STEP_IDS.has(step.id)) {
            const script = step.id as ScriptStepId;
            const isRetryingScript = retryingScript === script;
            return (
              <div
                key={step.id}
                data-step={step.id}
                className="hover:bg-muted/30 flex items-start gap-2 rounded-md p-1.5 transition-colors"
              >
                <button
                  type="button"
                  title="Open script output"
                  onClick={() => onOpenScript(script)}
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                >
                  {body}
                </button>
                {step.status === 'failed' ? (
                  <button
                    type="button"
                    disabled={isRetryingScript}
                    onClick={() => onRetryScript(script)}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-foreground-muted transition-colors hover:text-foreground disabled:opacity-60"
                  >
                    {isRetryingScript ? <Spinner size="sm" /> : <RotateCcw className="size-2.5" />}
                    Retry
                  </button>
                ) : null}
              </div>
            );
          }
          return (
            <div key={step.id} data-step={step.id} className="flex items-start gap-2 p-1.5">
              {body}
              {step.id === 'push-branch' && step.status === 'failed' ? (
                <button
                  type="button"
                  disabled={isRetryingPush}
                  onClick={onRetryPush}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-foreground-muted transition-colors hover:text-foreground disabled:opacity-60"
                >
                  {isRetryingPush ? <Spinner size="sm" /> : <RotateCcw className="size-2.5" />}
                  Retry
                </button>
              ) : null}
            </div>
          );
        })}
      </Popover.Content>
    </Popover.Root>
  );
}

export const ActivityBadge = observer(function ActivityBadge({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}) {
  const taskStore = getTaskStore(projectId, taskId);
  const workspace = useWorkspace();
  const taskView = useTaskComposition();
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryingScript, setRetryingScript] = useState<ScriptStepId | null>(null);
  const steps = taskStore?.workspaceLifecycle;
  if (!taskStore || !steps) return null;

  // The same drawer-activation path the script pill used: focus the script's
  // output tab, then open the bottom terminal drawer.
  const openScript = (script: ScriptStepId) => {
    const scripts = workspace.get(lifecycleScriptsStoreToken);
    const tabId = createLifecycleScriptTerminalId(script);
    scripts?.setActiveTab(tabId);
    taskView.setTerminalDrawerActiveItem({ kind: 'script', id: tabId });
    taskView.chrome.commands.openTerminalDrawer();
  };

  // The same mechanism as the drawer's play button: a fresh manual run against the
  // scripts plane, marked as a retry. Progress arrives through the timeline itself.
  const retryScript = async (script: ScriptStepId) => {
    const workspaceId = taskStore.workspaceId;
    if (!workspaceId) return;
    setRetryingScript(script);
    try {
      const client = await getLifecycleScriptsClient();
      const result = await client.start({ workspaceId, script, provenance: 'retry' });
      if (!result.success) {
        throw new Error(
          'message' in result.error ? result.error.message : 'The workspace no longer exists'
        );
      }
    } catch (error) {
      toast.error(`Could not retry the ${script} script`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRetryingScript(null);
    }
  };

  const retryPush = async () => {
    const workspaceId = taskStore.workspaceId;
    const project = asMounted(getProjectStore(projectId));
    if (!workspaceId || !project) return;
    setIsRetrying(true);
    try {
      const client = await getWorkspaceRegistryWireClient();
      const result = await client.retryStep({
        host: projectHostRef(project.data),
        workspaceId,
        step: 'push-branch',
      });
      if (!result.success) {
        throw new Error(
          'message' in result.error ? result.error.message : 'The workspace no longer exists'
        );
      }
    } catch (error) {
      toast.error('Could not push the branch', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <ActivityBadgeView
      steps={steps}
      onOpenScript={openScript}
      onRetryPush={() => void retryPush()}
      isRetryingPush={isRetrying}
      onRetryScript={(script) => void retryScript(script)}
      retryingScript={retryingScript}
    />
  );
});
