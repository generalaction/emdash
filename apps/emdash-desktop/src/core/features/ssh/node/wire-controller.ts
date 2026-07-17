import { createController, type Controller } from '@emdash/wire/api';
import { sshOperations } from '@main/core/ssh/controller';
import { sshContract } from '../api';
import { sshEvents } from './event-host';

export function createSshWireController(): Controller {
  return createController(sshContract, {
    getConnections: () => sshOperations.getConnections(),
    getSshConfigHosts: () => sshOperations.getSshConfigHosts(),
    getSshConfigHost: ({ alias }) => sshOperations.getSshConfigHost(alias),
    getConnectionUsage: () => sshOperations.getConnectionUsage(),
    saveConnection: (input) => sshOperations.saveConnection(input),
    deleteConnection: ({ id }) => sshOperations.deleteConnection(id),
    testConnection: (input) => sshOperations.testConnection(input),
    disconnect: ({ connectionId }) => sshOperations.disconnect(connectionId),
    connect: ({ connectionId }) => sshOperations.connect(connectionId),
    getState: ({ connectionId }) => sshOperations.getState(connectionId),
    getConnectionState: () => sshOperations.getConnectionState(),
    getHealthStates: () => sshOperations.getHealthStates(),
    renameConnection: ({ id, name }) => sshOperations.renameConnection(id, name),
    events: sshEvents,
  });
}
