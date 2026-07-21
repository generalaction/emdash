import type {
  AutomationRunTriggerKind,
  RunError,
} from '@core/features/automations/api/automation-run';

export function formatRunError(error: RunError | null): string {
  if (!error) return 'Unknown error';
  if (error.code === 'deadline_exceeded') {
    return 'Skipped because it waited in the queue for too long';
  }
  if (error.code === 'manually_stopped') return 'Manually stopped';
  if (error.step === 'provision_workspace') {
    return error.message ?? 'Could not prepare the automation workspace';
  }
  if (error.step === 'start_session') {
    return error.message ?? 'Could not start the agent session';
  }
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
  automation_not_configured: 'Finish configuring the automation before saving',
  automation_deployment_stale: 'This automation changed on its runtime. Try saving again.',
  automation_not_found: 'This automation no longer exists',
  automation_run_not_found: 'This automation run no longer exists',
  automation_run_workspace_not_ready: 'The automation workspace is not ready yet',
  automation_workspace_not_found: 'The selected workspace no longer exists',
  automation_workspace_not_supported: 'This workspace type cannot run an automation yet',
  conversation_config_prompt_required: 'Add a prompt before saving',
  cron_invalid: 'Enter a valid schedule',
  project_not_found: 'The selected project no longer exists',
};

export function formatAutomationError(error: unknown): string {
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : null;
  if (!msg) return 'Something went wrong';
  return FORM_ERROR_MESSAGES[msg] ?? msg;
}
