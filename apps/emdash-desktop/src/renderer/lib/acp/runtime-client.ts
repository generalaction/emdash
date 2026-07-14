import type { StartSessionInput } from '@emdash/core/runtimes/acp/api/client';
import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type AcpRuntimeRpcClient = DesktopWireClient['acp'];

export type { StartSessionInput };

export async function getAcpRuntimeClient(): Promise<AcpRuntimeRpcClient> {
  return (await getDesktopWireClient()).acp;
}

export function resetAcpRuntimeClient(): void {
  resetDesktopWireClient();
}
