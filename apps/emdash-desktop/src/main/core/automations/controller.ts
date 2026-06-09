import { createRPCController } from '@shared/lib/ipc/rpc';
import { automationsService } from './automations-service';

export const automationsController = createRPCController({
  listAutomations: automationsService.listAutomations.bind(automationsService),
  createAutomation: automationsService.createAutomation.bind(automationsService),
  updateAutomationSettings: automationsService.updateAutomationSettings.bind(automationsService),
  renameAutomation: automationsService.renameAutomation.bind(automationsService),
  setAutomationEnabled: automationsService.setAutomationEnabled.bind(automationsService),
  toggleAutomationEnabled: automationsService.toggleAutomationEnabled.bind(automationsService),
  listAutomationRuns: automationsService.listAutomationRuns.bind(automationsService),
  countAutomationRunsByStatus:
    automationsService.countAutomationRunsByStatus.bind(automationsService),
  getLatestRun: automationsService.getLatestRun.bind(automationsService),
  getNextScheduledRun: automationsService.getNextScheduledRun.bind(automationsService),
  runAutomation: automationsService.runAutomation.bind(automationsService),
  stopRun: automationsService.stopRun.bind(automationsService),
  getRun: automationsService.getRun.bind(automationsService),
  deleteAutomation: automationsService.deleteAutomation.bind(automationsService),
});
