import { awaitWirePort, client, connect, domPortTransport, type DomPortLike } from '@emdash/wire';
import { desktopWireContract } from '@core/manifests/shared/desktop-wire-contract';
import { DESKTOP_WIRE_CHANNEL } from '@core/manifests/shared/wire-channels';

export type DesktopWireClient = ReturnType<typeof createDesktopWireClientForPort>;

let clientPromise: Promise<DesktopWireClient> | null = null;

export function getDesktopWireClient(): Promise<DesktopWireClient> {
  clientPromise ??= createDesktopWireClient();
  return clientPromise;
}

export function resetDesktopWireClient(): void {
  clientPromise = null;
}

async function createDesktopWireClient(): Promise<DesktopWireClient> {
  const portPromise = awaitWirePort(window, { channel: DESKTOP_WIRE_CHANNEL });
  await window.electronAPI.requestWirePort(DESKTOP_WIRE_CHANNEL);
  return createDesktopWireClientForPort((await portPromise) as DomPortLike);
}

function createDesktopWireClientForPort(port: DomPortLike) {
  return client(desktopWireContract, connect(domPortTransport(port)));
}
