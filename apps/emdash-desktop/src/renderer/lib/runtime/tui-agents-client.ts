import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from './desktop-wire-client';

export type TuiAgentsRuntimeClient = DesktopWireClient['tuiAgents'];

export async function getTuiAgentsRuntimeClient(): Promise<TuiAgentsRuntimeClient> {
  return (await getDesktopWireClient()).tuiAgents;
}

export function resetTuiAgentsRuntimeClient(): void {
  resetDesktopWireClient();
}
