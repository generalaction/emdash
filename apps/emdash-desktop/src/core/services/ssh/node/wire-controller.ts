import { createController, type Controller } from '@emdash/wire/api';
import { sshContract } from '../api';
import type { SshConnectionsModel } from './connections-model';
import type { SshService } from './ssh-service';

export function createSshWireController(
  service: SshService,
  connections: SshConnectionsModel
): Controller {
  return createController(sshContract, {
    connections: connections.host,
    connect: ({ connectionId }) => service.connect(connectionId),
    disconnect: ({ connectionId }) => service.disconnect(connectionId),
    getSshConfigHosts: () => service.getSshConfigHosts(),
    getSshConfigHost: ({ alias }) => service.getSshConfigHost(alias),
    testConnection: (input) => service.testConnection(input),
  });
}
