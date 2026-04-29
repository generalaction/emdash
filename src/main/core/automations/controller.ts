import { isValidAction } from '@shared/automations/actions';
import { builtinAutomationCatalog } from '@shared/automations/builtin-catalog';
import type {
  Automation,
  AutomationRun,
  CreateAutomationInput,
  UpdateAutomationPatch,
} from '@shared/automations/types';
import { automationsChangedChannel } from '@shared/events/automationEvents';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok, type Result } from '@shared/result';
import { events } from '@main/lib/events';
import { automationScheduler } from './automation-scheduler';
import {
  createAutomation,
  getAutomation,
  listAutomations,
  listRuns,
  removeAutomation,
  setAutomationEnabled,
  updateAutomation,
} from './repo';
import { runAutomation } from './runtime';

async function notifyChanged(): Promise<void> {
  events.emit(automationsChangedChannel, undefined);
  await automationScheduler.reload();
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

  getCatalog() {
    return ok(builtinAutomationCatalog);
  },

  create(input: CreateAutomationInput): Promise<Result<Automation, string>> {
    return safe(async () => {
      if (!input.name.trim()) return err('name_required');
      if (!Array.isArray(input.actions) || input.actions.length === 0) {
        return err('actions_required');
      }
      const invalidIndex = input.actions.findIndex((action) => !isValidAction(action));
      if (invalidIndex >= 0) return err(`action_invalid:${invalidIndex}`);
      const automation = await createAutomation(input);
      await notifyChanged();
      return ok(automation);
    });
  },

  update(id: string, patch: UpdateAutomationPatch): Promise<Result<Automation, string>> {
    return safe(async () => {
      if (patch.actions !== undefined) {
        if (!Array.isArray(patch.actions) || patch.actions.length === 0) {
          return err('actions_required');
        }
        const invalidIndex = patch.actions.findIndex((action) => !isValidAction(action));
        if (invalidIndex >= 0) return err(`action_invalid:${invalidIndex}`);
      }
      const automation = await updateAutomation(id, patch);
      if (!automation) return err('automation_not_found');
      await notifyChanged();
      return ok(automation);
    });
  },

  remove(id: string): Promise<Result<void, string>> {
    return safe(async () => {
      const removed = await removeAutomation(id);
      if (!removed) return err('automation_not_found');
      await notifyChanged();
      return ok();
    });
  },

  setEnabled(id: string, enabled: boolean): Promise<Result<Automation, string>> {
    return safe(async () => {
      const automation = await setAutomationEnabled(id, enabled);
      if (!automation) return err('automation_not_found');
      await notifyChanged();
      return ok(automation);
    });
  },

  async runNow(id: string): Promise<Result<AutomationRun, string>> {
    const automation = await getAutomation(id);
    if (!automation) return err('automation_not_found');
    return runAutomation(automation, 'manual');
  },

  listRuns(automationId: string, limit = 20): Promise<Result<AutomationRun[], string>> {
    return safe(async () => ok(await listRuns(automationId, limit)));
  },
});
