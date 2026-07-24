import type {
  AutomationRunTriggerKind,
  RunError,
} from '@core/features/automations/api/automation-run';
import {
  automationAdoptionErrorSchema,
  automationDefinitionErrorSchema,
  type AutomationAdoptionError,
  type AutomationDefinitionError,
  type InvalidAutomationDefinitionReason,
} from '@core/primitives/automations/api';

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

const INVALID_DEFINITION_MESSAGES: Record<InvalidAutomationDefinitionReason, string> = {
  name_required: 'Give the automation a name',
  automation_not_configured: 'Finish configuring the automation before saving',
  conversation_config_prompt_required: 'Add a prompt before saving',
  cron_invalid: 'Enter a valid schedule',
};

export function formatAutomationError(error: unknown): string {
  const typedError = parseAutomationError(error);
  if (typedError) return formatTypedAutomationError(typedError);
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : null;
  if (!msg) return 'Something went wrong';
  return msg === 'cron_invalid' ? INVALID_DEFINITION_MESSAGES.cron_invalid : msg;
}

function parseAutomationError(
  error: unknown
): AutomationDefinitionError | AutomationAdoptionError | null {
  const candidate = error instanceof Error && error.cause !== undefined ? error.cause : error;
  const definition = automationDefinitionErrorSchema.safeParse(candidate);
  if (definition.success) return definition.data;
  const adoption = automationAdoptionErrorSchema.safeParse(candidate);
  return adoption.success ? adoption.data : null;
}

function formatTypedAutomationError(
  error: AutomationDefinitionError | AutomationAdoptionError
): string {
  switch (error.type) {
    case 'invalid-definition':
      return INVALID_DEFINITION_MESSAGES[error.reason];
    case 'project-not-found':
      return 'The selected project no longer exists';
    case 'automation-not-found':
      return 'This automation no longer exists';
    case 'automation-conflict':
      return 'This automation changed while it was being saved. Try again.';
    case 'workspace-not-found':
      return 'The selected workspace no longer exists';
    case 'workspace-not-supported':
      return 'This workspace type cannot run an automation yet';
    case 'deployment-stale':
      return 'This automation changed on its runtime. Try saving again.';
    case 'no-project-attached':
      return 'Attach this automation to a project before opening its runs';
    case 'run-not-found':
      return 'This automation run no longer exists';
    case 'run-not-adoptable':
      return 'The automation workspace is not ready yet';
    case 'adoption-unavailable':
    case 'runtime-unavailable':
      return error.message;
  }
}
