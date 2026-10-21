import type { AutomationRun as RuntimeAutomationRun } from '@emdash/core/runtimes/automations/api';

export type AdoptableAutomationRun = RuntimeAutomationRun & {
  status: 'done' | 'failed' | 'cancelled';
  workspace: NonNullable<RuntimeAutomationRun['workspace']>;
};

/** A run is safe to adopt once provisioning/session startup can no longer race the DB projection. */
export function isAutomationRunAdoptable(run: RuntimeAutomationRun): run is AdoptableAutomationRun {
  return (
    run.workspace !== null &&
    (run.status === 'done' || run.status === 'failed' || run.status === 'cancelled')
  );
}

export type {
  AutomationRun,
  AutomationRunError as RunError,
  AutomationRunStatus,
  AutomationRunTriggerKind,
} from '@emdash/core/runtimes/automations/api';
