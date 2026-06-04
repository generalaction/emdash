import cronstrue from 'cronstrue';
import type {
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTriggerKind,
} from '@shared/automations/automation-run';
import type { TriggerConfig } from '@shared/automations/config';

export const QUEUE_DEADLINE_EXCEEDED_ERROR = 'queue_deadline_exceeded' as const;

export function formatCronLabel(expr: string): string {
  try {
    return cronstrue.toString(expr.trim());
  } catch {
    return expr;
  }
}

export function formatTriggerLabel(trigger: TriggerConfig): string {
  return formatCronLabel(trigger.expr);
}

export function formatRunStatusLabel(status: AutomationRunStatus): string | null {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'running':
      return 'Running';
    case 'success':
      return null;
  }
}

export function isQueueDeadlineExceededRun(run: Pick<AutomationRun, 'status' | 'error'>): boolean {
  return run.status === 'skipped' && run.error === QUEUE_DEADLINE_EXCEEDED_ERROR;
}

const ERROR_MESSAGES = {
  project_not_found: 'Project could not be found or opened',
  task_create_prompt_empty: 'The task prompt is empty — add one before running',
  no_actions_configured: 'This automation has no actions yet',
  interrupted_by_restart: 'The run was interrupted because the app restarted',
  previous_still_running: 'Skipped because the previous run is still in progress',
  [QUEUE_DEADLINE_EXCEEDED_ERROR]: 'Skipped because it waited in the queue for too long',
  no_project_attached: 'Skipped because the automation is not attached to a project',
  automation_disabled: 'Skipped because the automation schedule was paused',
  name_required: 'Give the automation a name',
  name_too_long: 'The name is too long',
  actions_required: 'Add at least one action before saving',
  automation_not_found: 'This automation no longer exists',
  automation_is_draft: 'Finish setting up the automation before running it',
  automation_run_in_flight: 'Wait for the run to finish before deleting it',
  automation_run_already_queued: 'This automation already has a queued or running run',
  automation_run_not_found: 'This automation run no longer exists',
  cron_invalid: 'Enter a valid schedule',
  deadline_policy_invalid: 'Choose a valid deadline policy',
  deadline_ms_invalid: 'Choose a positive deadline duration',
  interrupted_by_restart_task_preserved:
    'The run was interrupted because the app restarted, but its agent was preserved',
  interrupted_by_restart_task_missing:
    'The run was interrupted because the app restarted and its agent could not be found',
  run_update_failed: 'The automation run could not be updated',
} as const;

const PREFIXED_ERROR_MESSAGES: ReadonlyArray<{
  prefix: string;
  format: (value: string) => string;
}> = [
  {
    prefix: 'initial_commit_required:',
    format: (value) => `Branch "${value}" has no commits yet`,
  },
  {
    prefix: 'branch_create_failed:',
    format: (value) => `Could not create branch "${value}"`,
  },
  {
    prefix: 'pr_fetch_failed:',
    format: (value) => `Could not fetch pull requests from "${value}"`,
  },
  {
    prefix: 'branch_not_found:',
    format: (value) => `Branch "${value}" was not found`,
  },
  {
    prefix: 'worktree_setup_failed:',
    format: (value) => `Could not set up the worktree for "${value}"`,
  },
] as const;

function knownErrorMessage(raw: string): string | undefined {
  return ERROR_MESSAGES[raw as keyof typeof ERROR_MESSAGES];
}

function normalizeActionError(raw: string): string {
  return raw.replace(/^action_\d+_[^:]+:/, '');
}

export function formatRunError(raw: string): string {
  const normalized = normalizeActionError(raw);
  const exact = knownErrorMessage(normalized);
  if (exact) return exact;

  for (const { prefix, format } of PREFIXED_ERROR_MESSAGES) {
    if (normalized.startsWith(prefix)) return format(normalized.slice(prefix.length));
  }

  if (normalized.startsWith('provisioning timed out'))
    return 'Setting up the task took too long and timed out';
  if (normalized.startsWith('action_invalid:'))
    return 'One of the actions is not configured correctly';

  return raw;
}

export function formatAutomationError(error: unknown): string {
  if (error instanceof Error) return formatRunError(error.message);
  if (typeof error === 'string') return formatRunError(error);
  return 'Something went wrong';
}

export function formatRunTriggerKindLabel(kind: AutomationRunTriggerKind): string {
  switch (kind) {
    case 'cron':
      return 'Schedule';
    case 'manual':
      return 'Manual';
  }
}
