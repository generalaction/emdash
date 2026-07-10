import { acpApiContract, type StartSessionInput } from '@emdash/core/acp/client';
import { awaitWirePort, client, connect, domPortTransport, type DomPortLike } from '@emdash/wire';

const ACP_WIRE_CHANNEL = 'acp-wire';

export type AcpRuntimeRpcClient = ReturnType<typeof createAcpClientForPort>;

let clientPromise: Promise<AcpRuntimeRpcClient> | null = null;
export type { StartSessionInput };

export function getAcpRuntimeClient(): Promise<AcpRuntimeRpcClient> {
  clientPromise ??= createAcpRuntimeClient();
  return clientPromise;
}

export function resetAcpRuntimeClient(): void {
  clientPromise = null;
}

async function createAcpRuntimeClient(): Promise<AcpRuntimeRpcClient> {
  const portPromise = awaitWirePort(window, { channel: ACP_WIRE_CHANNEL });
  await window.electronAPI.requestWirePort(ACP_WIRE_CHANNEL);
  const port = (await portPromise) as DomPortLike;
  return createAcpClientForPort(port);
}

function createAcpClientForPort(port: DomPortLike) {
  const transport = domPortTransport(port);
  return client(acpApiContract, connect(transport));
}
