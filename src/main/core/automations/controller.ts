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
import { automationRunEvents } from './automation-run-events';
import { automationRunDeadline, automationScheduler } from './automation-scheduler';
import {
  createAutomation,
  enqueueAutomationRun,
  getAutomation,
  listAutomations,
  listRecentRuns,
  listRuns,
  removeAutomation,
  removeRun as removeRunFromDb,
  setAutomationEnabled,
  updateAutomation,
} from './repo';
import { emitRunUpdated } from './runtime';

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
        if (!Array.isArray(input.actions) || input.actions.length === 0) {
          return err('actions_required');
        }
        const invalidIndex = input.actions.findIndex((action) => !isValidAction(action));
        if (invalidIndex >= 0) return err(`action_invalid:${invalidIndex}`);
      }
      const automation = await createAutomation(input);
      automationEvents._emit('automation:created', automation);
      emitChanged();
      return ok(automation);
    });
  },

  update(id: string, patch: UpdateAutomationPatch): Promise<Result<Automation, string>> {
    return safe(async () => {
      const nameError = validateName(patch.name);
      if (nameError) return err(nameError);
      if (patch.actions !== undefined && !patch.isDraft) {
        if (!Array.isArray(patch.actions) || patch.actions.length === 0) {
          return err('actions_required');
        }
        const invalidIndex = patch.actions.findIndex((action) => !isValidAction(action));
        if (invalidIndex >= 0) return err(`action_invalid:${invalidIndex}`);
      }
      const automation = await updateAutomation(id, patch);
      if (!automation) return err('automation_not_found');
      automationEvents._emit('automation:updated', automation);
      emitChanged();
      return ok(automation);
    });
  },

  remove(id: string): Promise<Result<void, string>> {
    return safe(async () => {
      const removed = await removeAutomation(id);
      if (!removed) return err('automation_not_found');
      automationEvents._emit('automation:deleted', id);
      emitChanged();
      return ok();
    });
  },

  setEnabled(id: string, enabled: boolean): Promise<Result<Automation, string>> {
    return safe(async () => {
      const automation = await setAutomationEnabled(id, enabled);
      if (!automation) return err('automation_not_found');
      automationEvents._emit('automation:updated', automation);
      emitChanged();
      return ok(automation);
    });
  },

  runNow(id: string): Promise<Result<AutomationRun, string>> {
    return safe(async () => {
      const automation = await getAutomation(id);
      if (!automation) return err('automation_not_found');
      if (automation.isDraft) return err('automation_is_draft');
      const scheduledAt = Date.now();
      const run = await enqueueAutomationRun({
        automationId: automation.id,
        scheduledAt,
        deadlineAt: automationRunDeadline(scheduledAt),
        triggerKind: 'manual',
      });
      if (!run) return err('automation_run_already_queued');
      emitRunUpdated(run);
      automationRunEvents._emit('run:queued', run, automation);
      void automationScheduler.drainQueue();
      return ok(run);
    });
  },

  listRuns(automationId: string, limit = 20): Promise<Result<AutomationRun[], string>> {
    return safe(async () => ok(await listRuns(automationId, limit)));
  },

  removeRun(id: string): Promise<Result<void, string>> {
    return safe(async () => {
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
});
