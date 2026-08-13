import { createController, type Controller } from '@emdash/wire/rpc';
import { hostsContract } from '../api';
import type { HostAvailabilityService } from './availability';
import type { HostService } from './host-service';

export function createHostsWireController(
  service: HostService,
  availability: HostAvailabilityService
): Controller {
  return createController(hostsContract, {
    availability: availability.host,
    serverStates: service.stateModel.host,
    refreshServerState: ({ connectionId, force }) =>
      service.refreshServerState(connectionId, { force }),
    installServer: ({ connectionId }) => service.installServer(connectionId),
    startServer: ({ connectionId }) => service.startServer(connectionId),
    stopServer: ({ connectionId }) => service.stopServer(connectionId),
    restartServer: ({ connectionId }) => service.restartServer(connectionId),
    updateServer: ({ connectionId }) => service.updateServer(connectionId),
  });
}
