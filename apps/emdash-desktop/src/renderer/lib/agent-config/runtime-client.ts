import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type AgentConfigRuntimeRpcClient = DesktopWireClient['agentConfig'];

export async function getAgentConfigRuntimeClient(): Promise<AgentConfigRuntimeRpcClient> {
  return (await getDesktopWireClient()).agentConfig;
}

export function resetAgentConfigRuntimeClient(): void {
  resetDesktopWireClient();
}
