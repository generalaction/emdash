import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from './desktop-wire-client';

export type TerminalsRuntimeClient = DesktopWireClient['terminals'];

export async function getTerminalsRuntimeClient(): Promise<TerminalsRuntimeClient> {
  return (await getDesktopWireClient()).terminals;
}

export function resetTerminalsRuntimeClient(): void {
  resetDesktopWireClient();
}
