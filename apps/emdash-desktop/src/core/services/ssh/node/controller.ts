import { createController, type Controller } from '@emdash/wire/rpc';
import type { SshService } from '@core/primitives/ssh/api';
import { sshContract } from '../api';
import type { SshConnectionsModel } from './connections-model';
import type { HostTrustRequests } from './host-trust-requests';

export function createSshWireController(
  service: SshService,
  connections: SshConnectionsModel,
  trust: HostTrustRequests
): Controller {
  return createController(sshContract, {
    connections: connections.host,
    hostTrust: trust.host,
    respondToHostTrust: ({ id, accepted }) => trust.respond(id, accepted),
    connect: ({ connectionId }) => service.connect(connectionId),
    ensureConnected: ({ connectionId }) => service.ensureConnected(connectionId),
    disconnect: ({ connectionId }) => service.disconnect(connectionId),
    getSshConfigHosts: () => service.getSshConfigHosts(),
    getSshConfigHost: ({ alias }) => service.getSshConfigHost(alias),
    testConnection: (input) => service.testConnection(input),
  });
}
