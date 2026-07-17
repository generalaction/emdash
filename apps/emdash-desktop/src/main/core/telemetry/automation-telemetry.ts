import type { AgentProviderId } from '@emdash/plugins/agents';
import { isValidProviderId } from '@main/core/agents/plugin-registry';
import { automationsService } from '@main/core/automations/automations-service';
import { telemetryService } from '@main/lib/telemetry';
import type { Automation } from '@shared/core/automations/automation';
import type { AutomationRun, AutomationRunStatus } from '@shared/core/automations/automation-run';

const TERMINAL_RUN_STATUSES = new Set<AutomationRunStatus>(['done', 'failed', 'skipped']);
const startedRunIds = new Set<string>();
const completedRunIds = new Set<string>();

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
    task_id: run.taskId ?? undefined,
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

automationsService.on('run:started', (run) => {
  captureRunStarted(run);
});

automationsService.on('run:step-completed', (run) => {
  if (run.status === 'creating_task') {
    captureRunStarted(run);
  }

  if (!TERMINAL_RUN_STATUSES.has(run.status) || completedRunIds.has(run.id)) return;
  completedRunIds.add(run.id);

  telemetryService.capture('automation_run_completed', {
    ...runTelemetryProps(run),
    status: run.status as 'done' | 'failed' | 'skipped',
    duration_ms: getDurationMs(run),
    error_step: run.error?.step,
    error_code: run.error?.code,
  });
  clearRunTelemetryDedupe(run.id);
});
