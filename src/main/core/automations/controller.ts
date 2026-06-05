import { randomBytes } from 'node:crypto';
import { isValidAction } from '@shared/automations/actions';
import {
  AUTOMATION_NAME_MAX_LENGTH,
  type Automation,
  type AutomationRun,
  type AutomationRunWithContext,
  type CreateAutomationInput,
  type UpdateAutomationPatch,
} from '@shared/automations/types';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok, type Result } from '@shared/result';
import { automationEvents } from './automation-events';
import { automationRunDeadline, automationScheduler } from './automation-scheduler';
import {
  createAutomation,
  enqueueAutomationRun,
  getAutomation,
  getRun,
  listAutomations,
  listRecentRuns,
  listRuns,
  removeAutomation,
  removeRun as removeRunFromDb,
  updateAutomation,
} from './repo';
import { emitQueuedRun } from './run-transitions';
import { setAutomationEnabled } from './service';

function emitChanged(): void {
  automationEvents._emit('automation:changed');
}

function validateName(name: string | undefined): string | null {
  if (name === undefined) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'name_required';
  if (trimmed.length > AUTOMATION_NAME_MAX_LENGTH) return 'name_too_long';
  return null;
}

function validateActions(actions: unknown): string | null {
  if (!Array.isArray(actions) || actions.length === 0) return 'actions_required';
  const invalidIndex = actions.findIndex((action) => !isValidAction(action));
  return invalidIndex >= 0 ? `action_invalid:${invalidIndex}` : null;
}

async function safe<T>(fn: () => Promise<Result<T, string>> | Result<T, string>) {
  try {
    return await fn();
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

export const automationsController = createRPCController({
  list(projectId?: string): Promise<Result<Automation[], string>> {
    return safe(async () => ok(await listAutomations(projectId)));
  },

  create(input: CreateAutomationInput): Promise<Result<Automation, string>> {
    return safe(async () => {
      const nameError = validateName(input.name);
      if (nameError) return err(nameError);
      if (!input.isDraft) {
        const actionsError = validateActions(input.actions);
        if (actionsError) return err(actionsError);
      }
      const automation = await createAutomation(input);
      emitChanged();
      return ok(automation);
    });
  },

  update(id: string, patch: UpdateAutomationPatch): Promise<Result<Automation, string>> {
    return safe(async () => {
      const nameError = validateName(patch.name);
      if (nameError) return err(nameError);
      if (patch.actions !== undefined) {
        const actionsError = validateActions(patch.actions);
        if (actionsError) return err(actionsError);
      }
      if (patch.isDraft === false && patch.actions === undefined) {
        const existing = await getAutomation(id);
        if (!existing) return err('automation_not_found');
        const actionsError = validateActions(existing.actions);
        if (actionsError) return err(actionsError);
      }
      const automation = await updateAutomation(id, patch);
      if (!automation) return err('automation_not_found');
      emitChanged();
      return ok(automation);
    });
  },

  remove(id: string): Promise<Result<void, string>> {
    return safe(async () => {
      const removed = await removeAutomation(id);
      if (!removed) return err('automation_not_found');
      emitChanged();
      return ok();
    });
  },

  setEnabled(id: string, enabled: boolean): Promise<Result<Automation, string>> {
    return safe(async () => {
      const automation = await setAutomationEnabled(id, enabled);
      if (!automation) return err('automation_not_found');
      emitChanged();
      return ok(automation);
    });
  },

  setProject(id: string, projectId: string): Promise<Result<Automation, string>> {
    return safe(async () => {
      const existing = await getAutomation(id);
      if (!existing) return err('automation_not_found');
      const wasDetached = existing.projectId == null;
      const updated = await updateAutomation(id, { projectId });
      if (!updated) return err('automation_not_found');
      // When re-attaching a previously active detached automation, restore its schedule.
      // Paused automations remain paused across detach/reattach.
      const automation =
        wasDetached && existing.enabled && !updated.isDraft
          ? ((await setAutomationEnabled(id, true)) ?? updated)
          : updated;
      emitChanged();
      return ok(automation);
    });
  },

  runNow(id: string): Promise<Result<AutomationRun, string>> {
    return safe(async () => {
      const automation = await getAutomation(id);
      if (!automation) return err('automation_not_found');
      if (automation.isDraft) return err('automation_is_draft');
      if (automation.projectId == null) return err('no_project_attached');
      // `enabled` only controls cron scheduling; paused automations can still run manually.
      const scheduledAt = Date.now();
      const run = await enqueueAutomationRun({
        automationId: automation.id,
        scheduledAt,
        deadlineAt: automationRunDeadline(automation, scheduledAt, 'manual'),
        triggerKind: 'manual',
      });
      if (!run) return err('automation_run_already_queued');
      emitQueuedRun(run);
      void automationScheduler.drainQueue();
      return ok(run);
    });
  },

  listRuns(automationId: string, limit = 20): Promise<Result<AutomationRun[], string>> {
    return safe(async () => ok(await listRuns(automationId, limit)));
  },

  removeRun(id: string): Promise<Result<void, string>> {
    return safe(async () => {
      const run = await getRun(id);
      if (!run) return err('automation_run_not_found');

      if (run.status === 'queued' || run.status === 'running') {
        return err('automation_run_in_flight');
      }

      const removed = await removeRunFromDb(id);
      if (!removed) return err('automation_run_not_found');
      emitChanged();
      return ok();
    });
  },

  listRecentRuns(
    projectId?: string,
    limit = 50
  ): Promise<Result<AutomationRunWithContext[], string>> {
    return safe(async () => ok(await listRecentRuns(projectId, limit)));
  },

  generateWebhookToken(): Result<string, string> {
    return ok(`wh_${randomBytes(24).toString('hex')}`);
  },

  async checkServerHealth(url: string, apiKey: string): Promise<Result<'online' | 'auth_error', string>> {
    try {
      const res = await fetch(`${url}/api/health`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return ok('online');
      if (res.status === 401) return ok('auth_error');
      return err(`http_${res.status}`);
    } catch (e) {
      return err(String(e));
    }
  },
});
