import { createRPCController } from '@shared/ipc/rpc';
import { automationsService } from './automations-service';

export const automationsController = createRPCController({
  listAutomations: automationsService.listAutomations.bind(automationsService),
  createAutomation: automationsService.createAutomation.bind(automationsService),
  updateAutomation: automationsService.updateAutomation.bind(automationsService),
  setAutomationEnabled: automationsService.setAutomationEnabled.bind(automationsService),
  listAutomationRuns: automationsService.listAutomationRuns.bind(automationsService),
  runAutomation: automationsService.runAutomation.bind(automationsService),
  stopRun: automationsService.stopRun.bind(automationsService),
  deleteAutomation: automationsService.deleteAutomation.bind(automationsService),
});
