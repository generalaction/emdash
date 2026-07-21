import { createController, type Controller, type LiveSource } from '@emdash/wire';
import type { AutomationsService } from '@core/features/automations/api/node/automations-service';
import { getAutomation } from '@core/features/automations/node/repo';
import { adoptRun } from '@core/features/automations/node/run-adoption';
import {
  resolveAutomationRuntime,
  type AutomationRuntimeDependencies,
  type AutomationRuntimeTarget,
} from '@core/features/automations/node/runtime-client-resolver';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { Project } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { automationsContract } from '../api';

type RunEventsKey = { automationId: string };

export function createAutomationsWireController(options: {
  db: AppDb;
  getProjectById(projectId: string): Promise<Project | undefined>;
  runtime: AutomationRuntimeDependencies;
  service: AutomationsService;
  taskService: Pick<TaskService, 'notifyTaskCreated'>;
}): Controller {
  const automationsService = options.service;
  return createController(automationsContract, {
    list: ({ projectId }) => automationsService.list(projectId),
    create: (input) => automationsService.create(input),
    update: ({ id, patch }) => automationsService.update(id, patch),
    delete: ({ automationId }) => automationsService.delete(automationId),
    adoptRun: ({ automationId, runId }) => adoptRun(options, automationId, runId),
    getTargetAvailability: ({ projectId }) => automationsService.getTargetAvailability(projectId),
    startRun: async (input) =>
      (await targetForAutomation(options, input.automationId)).client.startRun(input),
    cancelRun: async (input) =>
      (await targetForAutomation(options, input.automationId)).client.cancelRun(input),
    getRun: async (input) =>
      (await targetForAutomation(options, input.automationId)).client.getRun(input),
    listRuns: async (input) =>
      (await targetForAutomation(options, input.automationId)).client.listRuns(input),
    listChangedRuns: async (input) =>
      (await targetForAutomation(options, input.automationId)).client.listChangedRuns(input),
    getRunOverview: async (input) =>
      (await targetForAutomation(options, input.automationId)).client.getRunOverview(input),
    runEvents: (key) => lazyRunEventsSource(options, key),
  });
}

function lazyRunEventsSource(
  options: Parameters<typeof createAutomationsWireController>[0],
  key: RunEventsKey
): LiveSource {
  return {
    async snapshot() {
      const target = await targetForAutomation(options, key.automationId);
      return target.client.runEvents.handle(key).snapshot();
    },
    async subscribe(callback, subscribeOptions) {
      const target = await targetForAutomation(options, key.automationId);
      return target.client.runEvents
        .handle(key)
        .asLiveSource()
        .subscribe(callback, subscribeOptions);
    },
  };
}

async function targetForAutomation(
  options: Parameters<typeof createAutomationsWireController>[0],
  automationId: string
): Promise<AutomationRuntimeTarget> {
  const automation = await getAutomation(options.db, automationId);
  if (!automation) throw new Error('automation_not_found');
  return resolveAutomationRuntime(options.runtime, automation.projectId);
}
