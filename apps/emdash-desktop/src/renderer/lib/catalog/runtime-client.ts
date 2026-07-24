import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type CatalogRuntimeRpcClient = DesktopWireClient['catalog'];

export async function getCatalogRuntimeClient(): Promise<CatalogRuntimeRpcClient> {
  return (await getDesktopWireClient()).catalog;
}

export function resetCatalogRuntimeClient(): void {
  resetDesktopWireClient();
}
