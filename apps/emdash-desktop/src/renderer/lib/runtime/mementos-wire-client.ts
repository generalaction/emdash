import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type MementosWireClient = DesktopWireClient['mementos'];

export async function getMementosWireClient(): Promise<MementosWireClient> {
  return (await getDesktopWireClient()).mementos;
}

export function resetMementosWireClient(): void {
  resetDesktopWireClient();
}
