import { hostRef } from '@emdash/core/primitives/host/api';
import {
  runtimeResolveErrorAsError,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import { createController, type Controller } from '@emdash/wire/api';
import type { MachinesService } from '@core/features/machines/api/node/machines-service';
import { machinesContract } from '../api';

export function createMachinesWireController(
  service: MachinesService,
  runtimes: RuntimeBroker
): Controller {
  return createController(machinesContract, {
    getMachines: () => service.getMachines(),
    getMachineUsage: () => service.getMachineUsage(),
    getMachineMetrics: async ({ machineId }) => {
      const runtime = await runtimes.client(hostRef('remote', machineId));
      if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
      return await runtime.data.resourceUsage.sample(undefined);
    },
    saveMachine: (input) => service.saveMachine(input),
    deleteMachine: ({ id }) => service.deleteMachine(id),
    renameMachine: ({ id, name }) => service.renameMachine(id, name),
  });
}
