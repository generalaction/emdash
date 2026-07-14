import { getDesktopWireClient } from './desktop-wire-client';

export async function getTerminalTabsWireClient() {
  return (await getDesktopWireClient()).terminalTabs;
}
