import { createController, type Controller } from '@emdash/wire/api';
import { machinesContract } from '../api';
import type { MachinesService } from './machines-service';

export function createMachinesWireController(service: MachinesService): Controller {
  return createController(machinesContract, {
    getMachines: () => service.getMachines(),
    getMachineUsage: () => service.getMachineUsage(),
    saveMachine: (input) => service.saveMachine(input),
    deleteMachine: ({ id }) => service.deleteMachine(id),
    renameMachine: ({ id, name }) => service.renameMachine(id, name),
  });
}
