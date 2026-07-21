import { deferredLiveSource } from '@emdash/core/services/runtime-broker/api';
import { createController, type Controller } from '@emdash/wire';
import type { AutomationsService } from '@core/features/automations/api/node/automations-service';
import { adoptRun } from '@core/features/automations/node/run-adoption';
import {
  resolveAutomationRuntimeClient,
  type AutomationRuntimeDependencies,
} from '@core/features/automations/node/runtime-client-resolver';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { Project } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { automationsContract } from '../api';

export function createAutomationsWireController(options: {
  db: AppDb;
  getProjectById(projectId: string): Promise<Project | undefined>;
  runtime: AutomationRuntimeDependencies;
  service: AutomationsService;
  taskService: Pick<TaskService, 'notifyTaskCreated'>;
}): Controller {
  const automationsService = options.service;
  const resolveClient = (projectId: string | undefined) =>
    resolveAutomationRuntimeClient(options.runtime, projectId);
  return createController(automationsContract, {
    list: ({ projectId }) => automationsService.list(projectId),
    create: (input) => automationsService.create(input),
    update: ({ id, patch }) => automationsService.update(id, patch),
    delete: ({ automationId }) => automationsService.delete(automationId),
    adoptRun: ({ automationId, runId }) => adoptRun(options, automationId, runId),
    getTargetAvailability: ({ projectId }) => automationsService.getTargetAvailability(projectId),
    startRun: async ({ projectId, ...input }) =>
      (await resolveClient(projectId)).automations.startRun(input),
    cancelRun: async ({ projectId, ...input }) =>
      (await resolveClient(projectId)).automations.cancelRun(input),
    getRun: async ({ projectId, ...input }) =>
      (await resolveClient(projectId)).automations.getRun(input),
    listRuns: async ({ projectId, ...input }) =>
      (await resolveClient(projectId)).automations.listRuns(input),
    listChangedRuns: async ({ projectId, ...input }) =>
      (await resolveClient(projectId)).automations.listChangedRuns(input),
    getRunOverview: async ({ projectId, ...input }) =>
      (await resolveClient(projectId)).automations.getRunOverview(input),
    runEvents: ({ projectId, automationId }) =>
      deferredLiveSource(async () =>
        (await resolveClient(projectId)).automations.runEvents
          .handle({ automationId })
          .asLiveSource()
      ),
  });
}
