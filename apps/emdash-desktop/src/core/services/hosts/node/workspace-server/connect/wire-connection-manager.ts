import type { workspaceWireContract, WireInitializeResult } from '@emdash/core/workspace-server';
import { runWithTimeout, waitWithSignal, type Clock } from '@emdash/shared/scheduling';
import type { Connection, ContractClient, WireTransport } from '@emdash/wire/rpc';
import type { WorkspaceServerTarget } from '../../../api/targets';
import type { WorkspaceServerSshPort } from '../ports';
import { openLocalWorkspaceServerTransport } from './local-socket-transport';
import { initializeWorkspaceServerTransport } from './protocol';
import { openSshWorkspaceServerTransport } from './ssh-streamlocal-transport';

export type WorkspaceServerConnection = {
  target: WorkspaceServerTarget;
  client: ContractClient<typeof workspaceWireContract>;
  connection: Connection;
  ready(): Promise<WireInitializeResult>;
  currentHandshake(): WireInitializeResult | undefined;
};

export interface WorkspaceServerDialer {
  dialOnce(
    target: WorkspaceServerTarget,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<WireInitializeResult>;
  invalidateConnection(connectionId: string): Promise<void>;
}

export type WorkspaceServerDialerOptions = {
  clock?: Clock;
  protocolVersion?: string;
  client?: { id: string; appVersion: string };
  ssh?: WorkspaceServerSshPort;
  openTransport?: (target: WorkspaceServerTarget) => Promise<WireTransport>;
  invalidateConnection?(connectionId: string): Promise<void>;
};

/** Provisioning probes only. Retained connections and retries belong to the Host supervisor. */
export function createWorkspaceServerDialer(
  options: WorkspaceServerDialerOptions
): WorkspaceServerDialer {
  return {
    dialOnce: (target, dialOptions = {}) => dialOnce(target, options, dialOptions),
    invalidateConnection: (id) => options.invalidateConnection?.(id) ?? Promise.resolve(),
  };
}

function openWorkspaceServerTransport(
  target: WorkspaceServerTarget,
  options: WorkspaceServerDialerOptions
): Promise<WireTransport> {
  if (target.kind === 'local-socket') return openLocalWorkspaceServerTransport(target);
  if (!options.ssh) throw new Error('SSH control is required for a remote workspace-server target');
  return openSshWorkspaceServerTransport(target, options.ssh);
}

async function dialOnce(
  target: WorkspaceServerTarget,
  managerOptions: WorkspaceServerDialerOptions,
  options: { signal?: AbortSignal; timeoutMs?: number }
): Promise<WireInitializeResult> {
  const open =
    managerOptions.openTransport ??
    ((next: WorkspaceServerTarget) => openWorkspaceServerTransport(next, managerOptions));
  const openPromise = Promise.resolve().then(() => open(target));
  let transport: WireTransport | undefined;

  try {
    return await runWithTimeout(
      async (timeoutSignal) => {
        const candidate = await waitWithSignal(openPromise, timeoutSignal);
        transport = candidate;
        return await waitWithSignal(
          initializeWorkspaceServerTransport(
            candidate,
            managerOptions.protocolVersion,
            managerOptions.client
          ),
          timeoutSignal
        );
      },
      {
        timeoutMs: options.timeoutMs ?? 5_000,
        signal: options.signal,
        clock: managerOptions.clock,
      }
    );
  } finally {
    if (transport) {
      transport.close?.();
    } else {
      void openPromise.then(
        (lateTransport) => lateTransport.close?.(),
        () => {}
      );
    }
  }
}
