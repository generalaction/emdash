import type { AutomationRunTriggerKind, RunError } from '@shared/core/automations/automation-run';

type ErrorFormatter = (msg?: string) => string;

const RUN_ERROR_DISPLAY: Record<RunError['step'], Record<string, ErrorFormatter>> = {
  queue: {
    deadline_exceeded: () => 'Skipped because it waited in the queue for too long',
    no_project: () => 'Skipped because the automation is not attached to a project',
    previous_running: () => 'Skipped because the previous run is still in progress',
    manually_stopped: () => 'Manually stopped',
    disabled: () => 'Skipped because the automation schedule was paused',
    no_actions_configured: () => 'This automation has no actions yet',
  },
  create_task: {
    interrupted_by_restart: () => 'The run was interrupted because the app restarted',
    project_not_found: () => 'Project could not be found or opened',
    worktree_setup_failed: (branch) =>
      branch ? `Could not set up the worktree for "${branch}"` : 'Could not set up the worktree',
    branch_create_failed: (branch) =>
      branch ? `Could not create branch "${branch}"` : 'Could not create branch',
    branch_not_found: (branch) =>
      branch ? `Branch "${branch}" was not found` : 'Branch was not found',
    initial_commit_required: (branch) =>
      branch ? `Branch "${branch}" has no commits yet` : 'Branch has no commits yet',
    provision_timeout: (ms) =>
      ms ? `Setting up the task timed out after ${ms}ms` : 'Setting up the task timed out',
    pr_fetch_failed: (remote) =>
      remote ? `Could not fetch pull requests from "${remote}"` : 'Could not fetch pull requests',
  },
  launch_task: {
    provision_failed: (msg) => msg ?? 'Workspace setup failed',
    interrupted_by_restart: () => 'The run was interrupted because the app restarted',
  },
  create_conversation: {
    interrupted_by_restart: () => 'The run was interrupted because the app restarted',
    failed: (msg) => msg ?? 'Could not start the agent conversation',
  },
};

export function formatRunError(error: RunError | null): string {
  if (!error) return 'Unknown error';
  const stepMap = RUN_ERROR_DISPLAY[error.step];
  if (!stepMap) return error.message ?? `${error.step}:${error.code}`;
  const formatter = stepMap[error.code];
  if (formatter) return formatter(error.message);
  return error.message ?? `${error.step}:${error.code}`;
}

export function formatRunTriggerKindLabel(kind: AutomationRunTriggerKind): string {
  switch (kind) {
    case 'cron':
      return 'Triggered by schedule';
    case 'manual':
      return 'Triggered manually';
  }
}

const FORM_ERROR_MESSAGES: Record<string, string> = {
  name_required: 'Give the automation a name',
  name_too_long: 'The name is too long',
  actions_required: 'Add at least one action before saving',
  automation_not_found: 'This automation no longer exists',
  automation_run_in_flight: 'Wait for the run to finish before deleting it',
  automation_run_already_queued: 'This automation already has a queued or running run',
  automation_run_not_found: 'This automation run no longer exists',
  cron_invalid: 'Enter a valid schedule',
  deadline_policy_invalid: 'Choose a valid deadline policy',
  deadline_ms_invalid: 'Choose a positive deadline duration',
  run_update_failed: 'The automation run could not be updated',
  task_create_prompt_empty: 'The task prompt is empty — add one before running',
};

export function formatAutomationError(error: unknown): string {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : null;
  if (!msg) return 'Something went wrong';
  return FORM_ERROR_MESSAGES[msg] ?? msg;
}
