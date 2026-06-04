import { createRPCController } from '@shared/ipc/rpc';
import { createAutomation } from './operations/createAutomation';
import { listAutomations } from './operations/listAutomations';
import { setAutomationEnabled } from './operations/setAutomationEnabled';
import { updateAutomation } from './operations/updateAutomation';

export const automationsController = createRPCController({
  listAutomations,
  createAutomation,
  updateAutomation,
  setAutomationEnabled,
});
