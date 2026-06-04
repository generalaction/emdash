import { createRPCController } from '@shared/ipc/rpc';
import { createAutomation } from './operations/createAutomation';
import { listAutomations } from './operations/listAutomations';

export const automationsController = createRPCController({
  listAutomations,
  createAutomation,
});
