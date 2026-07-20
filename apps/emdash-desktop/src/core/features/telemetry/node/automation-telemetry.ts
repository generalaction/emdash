import type { AgentProviderId } from '@emdash/plugins/agents';
import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
} from '@core/primitives/automations/api';
import { isValidProviderId } from '@main/core/agents/plugin-registry';
import { automationsService } from '@main/core/automations/automations-service';
import { telemetryService } from '@main/lib/telemetry';

const TERMINAL_RUN_STATUSES = new Set<AutomationRunStatus>([
  'done',
  'failed',
  'skipped',
  'cancelled',
]);
const startedRunIds = new Set<string>();
const completedRunIds = new Set<string>();
let installed = false;

function automationTelemetryProps(automation: Automation) {
  return {
    automation_id: automation.id,
    project_id: automation.projectId,
    trigger_kind: 'cron' as const,
  };
}

function runTelemetryProps(run: AutomationRun) {
  return {
    automation_id: run.automationId,
    trigger_kind: run.triggerKind,
  };
}

function getProvider(automation: Automation): AgentProviderId | null {
  const provider = automation.conversationConfig?.provider;
  return isValidProviderId(provider) ? provider : null;
}

function getDurationMs(run: AutomationRun): number | undefined {
  if (run.startedAt == null || run.finishedAt == null) return undefined;
  return Math.max(0, run.finishedAt - run.startedAt);
}

function captureRunStarted(run: AutomationRun): void {
  if (startedRunIds.has(run.id)) return;
  startedRunIds.add(run.id);
  telemetryService.capture('automation_run_started', runTelemetryProps(run));
}

function clearRunTelemetryDedupe(runId: string): void {
  startedRunIds.delete(runId);
  completedRunIds.delete(runId);
}

export function installAutomationTelemetry(): void {
  if (installed) return;
  installed = true;

  automationsService.on('automation:created', (automation) => {
    telemetryService.capture('automation_created', {
      ...automationTelemetryProps(automation),
      enabled: automation.enabled,
      provider: getProvider(automation),
      has_initial_prompt: Boolean(automation.conversationConfig?.prompt?.trim()),
    });
  });

  automationsService.on('automation:enabled', (automation) => {
    telemetryService.capture('automation_enabled_changed', {
      ...automationTelemetryProps(automation),
      enabled: automation.enabled,
    });
  });

  automationsService.on('run:step-completed', (run) => {
    if (run.status === 'provisioning_workspace') {
      captureRunStarted(run);
    }

    if (!TERMINAL_RUN_STATUSES.has(run.status) || completedRunIds.has(run.id)) return;
    completedRunIds.add(run.id);

    telemetryService.capture('automation_run_completed', {
      ...runTelemetryProps(run),
      status: run.status as 'done' | 'failed' | 'skipped' | 'cancelled',
      duration_ms: getDurationMs(run),
      error_step: run.error?.step,
      error_code: run.error?.code,
    });
    clearRunTelemetryDedupe(run.id);
  });
}
