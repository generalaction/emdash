import { createController, type Controller } from '@emdash/wire/api';
import { automationOperations } from '@main/core/automations/controller';
import { automationsContract } from '../api';
import { automationEvents } from './event-host';

export function createAutomationsWireController(): Controller {
  return createController(automationsContract, {
    listAutomations: ({ projectId }) => automationOperations.listAutomations(projectId),
    createAutomation: (input) => automationOperations.createAutomation(input),
    updateAutomationSettings: ({ id, patch }) =>
      automationOperations.updateAutomationSettings(id, patch),
    renameAutomation: ({ id, name }) => automationOperations.renameAutomation(id, name),
    setAutomationEnabled: ({ id, enabled }) =>
      automationOperations.setAutomationEnabled(id, enabled),
    toggleAutomationEnabled: ({ id, enabled }) =>
      automationOperations.toggleAutomationEnabled(id, enabled),
    listAutomationRuns: ({ automationId, limit, offset, statusFilter }) =>
      automationOperations.listAutomationRuns(automationId, limit, offset, statusFilter),
    countAutomationRunsByStatus: ({ automationId }) =>
      automationOperations.countAutomationRunsByStatus(automationId),
    getLatestRun: ({ automationId }) => automationOperations.getLatestRun(automationId),
    getNextScheduledRun: ({ automationId }) =>
      automationOperations.getNextScheduledRun(automationId),
    runAutomation: ({ automationId }) => automationOperations.runAutomation(automationId),
    stopRun: ({ runId }) => automationOperations.stopRun(runId),
    getRun: ({ runId }) => automationOperations.getRun(runId),
    deleteAutomation: ({ automationId }) => automationOperations.deleteAutomation(automationId),
    events: automationEvents,
  });
}
