import { createRPCController } from '@shared/ipc/rpc';
import { createAutomation } from './operations/createAutomation';
import { listAutomationRuns } from './operations/listAutomationRuns';
import { listAutomations } from './operations/listAutomations';
import { runAutomation } from './operations/runAutomation';
import { setAutomationEnabled } from './operations/setAutomationEnabled';
import { stopRun } from './operations/stopRun';
import { updateAutomation } from './operations/updateAutomation';

export const automationsController = createRPCController({
  listAutomations,
  createAutomation,
  updateAutomation,
  setAutomationEnabled,
  listAutomationRuns,
  runAutomation,
  stopRun,
});
