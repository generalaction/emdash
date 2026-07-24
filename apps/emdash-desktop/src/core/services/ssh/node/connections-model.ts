import { createLiveModelHost, type LiveInstance, type LiveModelHost } from '@emdash/wire';
import type { ConnectionState, SshConnectionEvent } from '@core/primitives/ssh/api';
import { sshContract, type SshConnectionsRuntime } from '../api';

export class SshConnectionsModel {
  readonly host: LiveModelHost<typeof sshContract.connections>;
  readonly instance: LiveInstance<typeof sshContract.connections>;

  constructor() {
    this.host = createLiveModelHost(sshContract.connections);
    this.instance = this.host.create(undefined, { runtime: {} });
  }

  publishEvent(event: SshConnectionEvent): void {
    this.instance.states.runtime.produce((runtime) => {
      if (event.type === 'health-changed') {
        runtime[event.connectionId] = {
          state: runtime[event.connectionId]?.state ?? 'disconnected',
          health: event.health,
        };
        return;
      }

      setState(runtime, event.connectionId, stateForEvent(event));
    });
  }

  remove(connectionId: string): void {
    this.instance.states.runtime.produce((runtime) => {
      delete runtime[connectionId];
    });
  }

  dispose(): void {
    this.host.dispose();
  }
}

function setState(
  runtime: SshConnectionsRuntime,
  connectionId: string,
  state: ConnectionState
): void {
  runtime[connectionId] = {
    state,
    health: runtime[connectionId]?.health ?? { status: 'ok' },
  };
}

function stateForEvent(
  event: Exclude<SshConnectionEvent, { type: 'health-changed' }>
): ConnectionState {
  switch (event.type) {
    case 'connected':
    case 'reconnected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'disconnected':
    case 'reconnect-failed':
      return 'disconnected';
    case 'error':
      return 'error';
  }
}
