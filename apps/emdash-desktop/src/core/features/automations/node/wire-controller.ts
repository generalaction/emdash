import { err, ok } from '@emdash/shared';
import { createController, type Controller, type LeasedLiveModelProvider } from '@emdash/wire';
import type { AutomationsService } from '@core/features/automations/api/node/automations-service';
import { enqueueDeleteAutomation } from '@core/features/automations/node/operations/delete-automation-definition';
import { adoptRun } from '@core/features/automations/node/run-adoption';
import {
  resolveAutomationRuntimeClient,
  type AutomationRuntimeDependencies,
} from '@core/features/automations/node/runtime-client-resolver';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { AutomationDefinitionError } from '@core/primitives/automations/api';
import type { DeletionMutationError } from '@core/primitives/operations/api';
import type { Project } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import type { OperationsEngine } from '@core/services/operations/node';
import { automationsContract } from '../api';

export function createAutomationsWireController(options: {
  db: AppDb;
  getProjectById(projectId: string): Promise<Project | undefined>;
  operations: OperationsEngine;
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
    delete: async ({ automationId }) => {
      const result = await enqueueDeleteAutomation(options.operations, automationId);
      if (!result.success) return err(toAutomationDefinitionError(result.error, automationId));
      automationsService.notifyDeleted(automationId);
      return ok(undefined);
    },
    retryDelete: ({ automationId }) => options.operations.retryDelete('automation', automationId),
    forgetWithoutCleanup: ({ automationId }) =>
      options.operations.forgetWithoutCleanup('automation', automationId),
    deletions: createAutomationDeletionsProvider(options.operations),
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
    runEvents: async ({ projectId, automationId }) =>
      (await resolveClient(projectId)).automations.runEvents
        .handle({ automationId })
        .asLiveSource(),
  });
}

function createAutomationDeletionsProvider(
  operations: OperationsEngine
): LeasedLiveModelProvider<typeof automationsContract.deletions> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: automationsContract.deletions,
    acquireState(key, name) {
      let lease: ReturnType<OperationsEngine['acquireDeletionState']> | undefined;
      let released = false;
      return {
        ready: async () => {
          if (name !== 'list') {
            throw new Error(`Unknown automation deletion state '${String(name)}'`);
          }
          if (released) {
            throw new Error('Automation deletion state lease was released before ready');
          }
          lease ??= operations.acquireDeletionState('automation', key.entityId);
          if (released) {
            await lease.release();
            throw new Error('Automation deletion state lease was released before ready');
          }
          return lease.ready();
        },
        release: async () => {
          released = true;
          await lease?.release();
        },
      };
    },
    async runMutation() {
      throw new Error('Automation deletions model does not expose mutations');
    },
    async dispose() {},
  };
}

function toAutomationDefinitionError(
  error: DeletionMutationError,
  automationId: string
): AutomationDefinitionError {
  return error.type === 'automation-not-found'
    ? { type: 'automation-not-found', automationId, message: error.message }
    : { type: 'runtime-unavailable', message: error.message };
}
