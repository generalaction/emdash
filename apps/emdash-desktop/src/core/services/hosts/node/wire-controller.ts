import { hostRef, sshConnectionIdOf } from '@emdash/core/primitives/host/api';
import { createController, type Controller } from '@emdash/wire/rpc';
import type { SshService } from '@core/primitives/ssh/api';
import { hostsContract } from '../api';
import type { HostAvailabilityService } from './availability';
import type { Hosts } from './hosts';

export function createHostsWireController(
  service: Hosts,
  availability: HostAvailabilityService,
  ssh: Pick<SshService, 'disconnect'>
): Controller {
  const server = (id: string) => {
    const host = service.get(hostRef('remote', id));
    if (!host) throw new Error(`Host '${id}' is not managed`);
    return host.server;
  };
  return createController(hostsContract, {
    availability: availability.host,
    disconnect: async ({ host }) => {
      const connectionId = sshConnectionIdOf(host);
      if (!connectionId) throw new Error('Local Host does not support SSH Disconnect');
      await ssh.disconnect(connectionId);
    },
    requestReady: async ({ host, cause }) => {
      const id = sshConnectionIdOf(host);
      if (id) {
        const current = service.get(host);
        if (!current) throw new Error(`Host '${id}' is not managed`);
        const result = await current.connection.pin();
        if (!result.success) throw result.error;
      } else availability.requestReady(host, cause);
    },
    wake: ({ cause }) => availability.wakeDemanded(cause),
    serverStates: service.stateModel.host,
    refreshServerState: ({ connectionId, force }) => server(connectionId).refresh({ force }),
    installServer: ({ connectionId }) => server(connectionId).install(),
    startServer: ({ connectionId }) => server(connectionId).start(),
    stopServer: ({ connectionId }) => server(connectionId).stop(),
    restartServer: ({ connectionId }) => server(connectionId).restart(),
    updateServer: ({ connectionId }) => server(connectionId).update(),
  });
}
