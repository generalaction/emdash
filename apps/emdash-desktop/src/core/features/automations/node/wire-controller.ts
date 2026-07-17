import { createController, type Controller, type LiveSource } from '@emdash/wire';
import { automationsService } from '@main/core/automations/automations-service';
import { getAutomation } from '@main/core/automations/repo';
import { adoptRun } from '@main/core/automations/run-adoption';
import {
  resolveAutomationRuntime,
  type AutomationRuntimeTarget,
} from '@main/core/automations/runtime-client-resolver';
import { automationsContract } from '../api';

type RunEventsKey = { automationId: string };

export function createAutomationsWireController(): Controller {
  return createController(automationsContract, {
    list: ({ projectId }) => automationsService.list(projectId),
    create: (input) => automationsService.create(input),
    update: ({ id, patch }) => automationsService.update(id, patch),
    delete: ({ automationId }) => automationsService.delete(automationId),
    adoptRun: ({ automationId, runId }) => adoptRun(automationId, runId),
    getTargetAvailability: ({ projectId }) => automationsService.getTargetAvailability(projectId),
    startRun: async (input) =>
      (await targetForAutomation(input.automationId)).client.startRun(input),
    cancelRun: async (input) =>
      (await targetForAutomation(input.automationId)).client.cancelRun(input),
    getRun: async (input) => (await targetForAutomation(input.automationId)).client.getRun(input),
    listRuns: async (input) =>
      (await targetForAutomation(input.automationId)).client.listRuns(input),
    listChangedRuns: async (input) =>
      (await targetForAutomation(input.automationId)).client.listChangedRuns(input),
    getRunOverview: async (input) =>
      (await targetForAutomation(input.automationId)).client.getRunOverview(input),
    runEvents: (key) => lazyRunEventsSource(key),
  });
}

function lazyRunEventsSource(key: RunEventsKey): LiveSource {
  return {
    async snapshot() {
      const target = await targetForAutomation(key.automationId);
      return target.client.runEvents.handle(key).snapshot();
    },
    async subscribe(callback, options) {
      const target = await targetForAutomation(key.automationId);
      return target.client.runEvents.handle(key).asLiveSource().subscribe(callback, options);
    },
  };
}

async function targetForAutomation(automationId: string): Promise<AutomationRuntimeTarget> {
  const automation = await getAutomation(automationId);
  if (!automation) throw new Error('automation_not_found');
  return resolveAutomationRuntime(automation.projectId);
}
