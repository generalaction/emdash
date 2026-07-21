import type { WireInitializeResult } from '@emdash/core/workspace-server';
import { runWithTimeout, waitWithSignal, type Clock } from '@emdash/shared/scheduling';
import type { WireTransport } from '@emdash/wire';
import type { WorkspaceServerSshPort } from '../ports';
import type { WorkspaceServerTarget } from '../targets';
import { openWorkspaceServerTransport } from './client-source';
import { initializeWorkspaceServerTransport } from './protocol';

export type DialWorkspaceServerOnceOptions = {
  ssh?: WorkspaceServerSshPort;
  protocolVersion?: string;
  openTransport?: (target: WorkspaceServerTarget) => Promise<WireTransport>;
  timeoutMs?: number;
  signal?: AbortSignal;
  clock?: Clock;
};

const DEFAULT_DIAL_TIMEOUT_MS = 5_000;

export async function dialWorkspaceServerOnce(
  target: WorkspaceServerTarget,
  options: DialWorkspaceServerOnceOptions = {}
): Promise<WireInitializeResult> {
  const open = options.openTransport ?? ((next) => openWorkspaceServerTransport(next, options));
  const openPromise = Promise.resolve().then(() => open(target));
  let transport: WireTransport | undefined;

  try {
    return await runWithTimeout(
      async (timeoutSignal) => {
        const candidate = await waitWithSignal(openPromise, timeoutSignal);
        transport = candidate;
        return await waitWithSignal(
          initializeWorkspaceServerTransport(candidate, options.protocolVersion),
          timeoutSignal
        );
      },
      {
        timeoutMs: options.timeoutMs ?? DEFAULT_DIAL_TIMEOUT_MS,
        signal: options.signal,
        clock: options.clock,
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
