import { isValidAction } from '@shared/automations/actions';
import { builtinAutomationCatalog } from '@shared/automations/builtin-catalog';
import type { EventTriggerFilters } from '@shared/automations/events';
import {
  AUTOMATION_NAME_MAX_LENGTH,
  type Automation,
  type AutomationRun,
  type AutomationRunWithContext,
  type CreateAutomationInput,
  type TriggerSpec,
  type UpdateAutomationPatch,
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
  listRecentRuns,
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

const FILTER_LIST_MAX = 50;
const FILTER_ENTRY_MAX_LEN = 200;

function validateFilterList(list: unknown): string | null {
  if (list === undefined) return null;
  if (!Array.isArray(list)) return 'filter_list_not_array';
  if (list.length > FILTER_LIST_MAX) return 'filter_list_too_long';
  for (const entry of list) {
    if (typeof entry !== 'string') return 'filter_entry_not_string';
    if (entry.length === 0 || entry.length > FILTER_ENTRY_MAX_LEN) {
      return 'filter_entry_invalid_length';
    }
  }
  return null;
}

function validateName(name: string | undefined): string | null {
  if (name === undefined) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'name_required';
  if (trimmed.length > AUTOMATION_NAME_MAX_LENGTH) return 'name_too_long';
  return null;
}

function validateTrigger(trigger: TriggerSpec | undefined): string | null {
  if (!trigger || trigger.kind !== 'event') return null;
  const filters: EventTriggerFilters | undefined = trigger.filters;
  if (!filters) return null;
  return (
    validateFilterList(filters.branches) ??
    validateFilterList(filters.authorsInclude) ??
    validateFilterList(filters.authorsExclude)
  );
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
      const nameError = validateName(input.name);
      if (nameError) return err(nameError);
      if (!Array.isArray(input.actions) || input.actions.length === 0) {
        return err('actions_required');
      }
      const invalidIndex = input.actions.findIndex((action) => !isValidAction(action));
      if (invalidIndex >= 0) return err(`action_invalid:${invalidIndex}`);
      const triggerError = validateTrigger(input.trigger);
      if (triggerError) return err(triggerError);
      const automation = await createAutomation(input);
      await notifyChanged();
      return ok(automation);
    });
  },

  update(id: string, patch: UpdateAutomationPatch): Promise<Result<Automation, string>> {
    return safe(async () => {
      const nameError = validateName(patch.name);
      if (nameError) return err(nameError);
      if (patch.actions !== undefined) {
        if (!Array.isArray(patch.actions) || patch.actions.length === 0) {
          return err('actions_required');
        }
        const invalidIndex = patch.actions.findIndex((action) => !isValidAction(action));
        if (invalidIndex >= 0) return err(`action_invalid:${invalidIndex}`);
      }
      const triggerError = validateTrigger(patch.trigger);
      if (triggerError) return err(triggerError);
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

  listRecentRuns(
    projectId?: string,
    limit = 50
  ): Promise<Result<AutomationRunWithContext[], string>> {
    return safe(async () => ok(await listRecentRuns(projectId, limit)));
  },
});
