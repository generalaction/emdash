import { agentConfigContract } from '@emdash/core/workspace-server/agent-config';
import { awaitWirePort, client, connect, domPortTransport, type DomPortLike } from '@emdash/wire';

const AGENT_CONFIG_WIRE_CHANNEL = 'agent-config-wire';

export type AgentConfigRuntimeRpcClient = ReturnType<typeof createAgentConfigClientForPort>;

let clientPromise: Promise<AgentConfigRuntimeRpcClient> | null = null;

export function getAgentConfigRuntimeClient(): Promise<AgentConfigRuntimeRpcClient> {
  clientPromise ??= createAgentConfigRuntimeClient();
  return clientPromise;
}

export function resetAgentConfigRuntimeClient(): void {
  clientPromise = null;
}

async function createAgentConfigRuntimeClient(): Promise<AgentConfigRuntimeRpcClient> {
  const portPromise = awaitWirePort(window, { channel: AGENT_CONFIG_WIRE_CHANNEL });
  await window.electronAPI.requestWirePort(AGENT_CONFIG_WIRE_CHANNEL);
  const port = (await portPromise) as DomPortLike;
  return createAgentConfigClientForPort(port);
}

function createAgentConfigClientForPort(port: DomPortLike) {
  const transport = domPortTransport(port);
  return client(agentConfigContract, connect(transport));
}
