import {
  getDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type McpRpcClient = DesktopWireClient['mcp'];

export async function getMcpClient(): Promise<McpRpcClient> {
  return (await getDesktopWireClient()).mcp;
}
