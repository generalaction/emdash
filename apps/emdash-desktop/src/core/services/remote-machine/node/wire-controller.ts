import { createController, type Controller } from '@emdash/wire/api';
import { remoteMachineContract } from '../api';
import type { RemoteMachineService } from './remote-machine-service';

export function createRemoteMachineWireController(service: RemoteMachineService): Controller {
  return createController(remoteMachineContract, {
    serverStates: service.stateModel.host,
    refreshServerState: ({ connectionId }) => service.refreshServerState(connectionId),
    installServer: ({ connectionId }) => service.installServer(connectionId),
    startServer: ({ connectionId }) => service.startServer(connectionId),
    stopServer: ({ connectionId }) => service.stopServer(connectionId),
    restartServer: ({ connectionId }) => service.restartServer(connectionId),
    updateServer: ({ connectionId }) => service.updateServer(connectionId),
  });
}
