import { hostRef } from '@emdash/core/primitives/host/api';
import {
  negotiateProtocol,
  PROTOCOL_VERSION,
  workspaceWireContract,
} from '@emdash/core/workspace-server';
import { err, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { deferred, type Deferred } from '@emdash/shared/testing';
import {
  client,
  createController,
  createWireSessionHub,
  defineContract,
  liveModel,
  liveState,
  memoryTransportPair,
  procedure,
  type WireTransport,
} from '@emdash/wire/rpc';
import { cell, expose, peek } from '@emdash/wire/state';
import { z } from 'zod';
import {
  ManagedHostConnection,
  type ManagedHostConnectionOptions,
} from '../managed-host-connection';
import { translateHostPreparationError } from '../runtime-resolution';
import type { WorkspaceServerConnection } from '../workspace-server/connect/wire-connection-manager';

// The production initialize/health schemas plus a tiny observable remote resource.
// Only the remote peer and network are simulated; client-side lifecycle is real.
export const peerContract = defineContract({
  initialize: workspaceWireContract.initialize,
  health: workspaceWireContract.health,
  observation: liveModel({
    key: z.void(),
    states: { value: liveState({ data: z.number() }) },
  }),
  increment: procedure({ input: z.void(), output: z.number() }),
});

export type FaultChannel = {
  transport: WireTransport;
  dropRequests: boolean;
  dropReplies: boolean;
  closed: boolean;
  disconnect(): void;
};

export function createFaultPeer() {
  const observation = cell(0);
  const provider = expose(peerContract.observation, { value: observation });
  const channels: FaultChannel[] = [];
  const hubs: ReturnType<typeof createWireSessionHub>[] = [];
  const gates: Deferred<void>[] = [];
  let openGate: Deferred<void> | undefined;
  let initializeGate: Deferred<void> | undefined;
  let disposed = false;
  let offline = false;
  let daemonId = 'daemon-1';
  let protocolVersion = PROTOCOL_VERSION;
  let opens = 0;
  let initializations = 0;
  let executions = 0;

  async function openTransport(): Promise<WireTransport> {
    opens += 1;
    const pendingOpen = openGate;
    if (pendingOpen) await pendingOpen.promise;
    if (offline) throw new Error('Network unreachable');

    const pair = memoryTransportPair();
    const channel: FaultChannel = {
      dropRequests: false,
      dropReplies: false,
      closed: false,
      transport: {
        ...pair.left,
        post(message) {
          if (!channel.dropRequests) pair.left.post(message);
        },
        close() {
          channel.disconnect();
        },
      },
      disconnect() {
        channel.closed = true;
        pair.disconnect();
      },
    };
    const pendingInitialize = initializeGate;
    const connectedDaemonId = daemonId;
    const connectedProtocolVersion = protocolVersion;
    const controller = createController(peerContract, {
      initialize: async ({ protocolVersion: clientVersion }) => {
        initializations += 1;
        if (pendingInitialize) await pendingInitialize.promise;
        const negotiated = negotiateProtocol(clientVersion, connectedProtocolVersion);
        if (!negotiated.compatible) {
          return err({
            type: 'protocol-incompatible' as const,
            action: negotiated.action,
            clientProtocolVersion: clientVersion,
            serverProtocolVersion: connectedProtocolVersion,
          });
        }
        return ok({
          protocolVersion: connectedProtocolVersion,
          agreedVersion: negotiated.agreedVersion,
          agreedMinor: negotiated.agreedMinor,
          server: { daemonId: connectedDaemonId, appVersion: '1.0.0', startedAt: 0 },
        });
      },
      health: () => ({
        status: 'ok' as const,
        version: '1.0.0',
        uptimeMs: 0,
        protocolVersion: connectedProtocolVersion,
      }),
      observation: provider,
      increment: () => ++executions,
    });
    const hub = createWireSessionHub(controller);
    hub.open(`attachment-${opens}`, {
      ...pair.right,
      post(message) {
        if (!channel.dropReplies) pair.right.post(message);
      },
      close() {
        channel.disconnect();
      },
    });
    channels.push(channel);
    hubs.push(hub);
    if (disposed) channel.disconnect();
    return channel.transport;
  }

  return {
    openTransport,
    observation,
    channels,
    get opens() {
      return opens;
    },
    get initializations() {
      return initializations;
    },
    get executions() {
      return executions;
    },
    get current(): FaultChannel {
      const channel = channels.at(-1);
      if (!channel) throw new Error('Fixture has no established channel');
      return channel;
    },
    setOffline(value: boolean) {
      offline = value;
    },
    get offline() {
      return offline;
    },
    setDaemonId(value: string) {
      daemonId = value;
    },
    setProtocolVersion(value: string) {
      protocolVersion = value;
    },
    stallOpen() {
      const gate = deferred<void>();
      gates.push(gate);
      openGate = gate;
      return () => {
        if (openGate === gate) openGate = undefined;
        gate.resolve();
      };
    },
    stallInitialize() {
      const gate = deferred<void>();
      gates.push(gate);
      initializeGate = gate;
      return () => {
        if (initializeGate === gate) initializeGate = undefined;
        gate.resolve();
      };
    },
    async dispose() {
      disposed = true;
      for (const gate of gates) gate.resolve();
      await Promise.all(hubs.map((hub) => hub.dispose()));
      await provider.dispose();
    },
  };
}

/** Real supervisor with only network, intent storage, and provisioning substituted. */
export function createSupervisorDriver(
  peer: ReturnType<typeof createFaultPeer>,
  options: Partial<ManagedHostConnectionOptions> = {}
) {
  const scope = createScope({ label: 'host-supervisor-acceptance' });
  const host = hostRef('remote', 'acceptance-host');
  const target = { kind: 'ssh' as const, sshConnectionId: host.id, socketPath: '/workspace.sock' };
  let enabled = true;
  let sshConnected = true;
  const managed = new ManagedHostConnection({
    scope,
    host,
    random: () => 0.5,
    intent: {
      read: async () => enabled,
      write: async (value) => {
        enabled = value;
      },
    },
    ssh: {
      connected: () => sshConnected,
      establish: async () => {
        sshConnected = true;
      },
      reset: () => {
        sshConnected = false;
      },
      probe: async () => {
        if (peer.offline) throw new Error('SSH path is blackholed');
      },
    },
    runtime: { prepare: async () => target, open: () => peer.openTransport(), cancel() {} },
    ...options,
  });
  const supervisor = managed.supervisor;
  const connectRuntime = async () => {
    const pinned = await managed.pin();
    if (!pinned.success) throw pinned.error;
    await supervisor.awaitUsable();
  };
  const result = async (work: Promise<unknown>) => {
    try {
      await work;
      return ok();
    } catch (error) {
      return err(translateHostPreparationError(host, 'handshaking', error));
    }
  };

  return {
    supervisor,
    managed,
    connectRuntime,
    get state() {
      return peek(supervisor.availability);
    },
    async connect() {
      return await result(connectRuntime());
    },
    getAttachment: async () => supervisor.attachment,
    awaitUsable: () => result(supervisor.awaitUsable()),
    revalidate: (cause: 'online' | 'focus') => supervisor.revalidate(cause),
    retry: () => supervisor.revalidate('retry'),
    async disconnect() {
      const disconnected = await managed.disconnect();
      if (!disconnected.success) throw disconnected.error;
    },
    async dispose() {
      await scope.dispose();
    },
  };
}

export function resourceClient(connection: WorkspaceServerConnection) {
  return client(peerContract, connection.connection);
}

export function observePromise<T>(promise: Promise<T>) {
  let outcome: 'pending' | 'fulfilled' | 'rejected' = 'pending';
  void promise.then(
    () => {
      outcome = 'fulfilled';
    },
    () => {
      outcome = 'rejected';
    }
  );
  return {
    get outcome() {
      return outcome;
    },
  };
}
