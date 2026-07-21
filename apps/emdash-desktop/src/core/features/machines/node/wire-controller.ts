import { createController, type Controller } from '@emdash/wire/api';
import type { MachinesService } from '@core/features/machines/api/node/machines-service';
import { machinesContract } from '../api';

export function createMachinesWireController(service: MachinesService): Controller {
  return createController(machinesContract, {
    getMachines: () => service.getMachines(),
    getMachineUsage: () => service.getMachineUsage(),
    saveMachine: (input) => service.saveMachine(input),
    deleteMachine: ({ id }) => service.deleteMachine(id),
    renameMachine: ({ id, name }) => service.renameMachine(id, name),
  });
}
