import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type TerminalsClient = DesktopWireClient['terminals'];

export async function getTerminalsClient(): Promise<TerminalsClient> {
  return (await getDesktopWireClient()).terminals;
}

export function resetTerminalsClient(): void {
  resetDesktopWireClient();
}
