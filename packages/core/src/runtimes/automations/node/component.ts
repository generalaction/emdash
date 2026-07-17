import { automationsContract } from '../api';
import { createAutomationsController } from '../api/controller';
import { AutomationsRuntime } from './runtime';

export const automationsComponent = defineWireComponent({
  id: 'automations',
  contract: automationsContract,
  requirements: {},
  create: () => {
    return instance({
      controller: createAutomationsController({ runtime: new AutomationsRuntime() }),
    });
  },
});
