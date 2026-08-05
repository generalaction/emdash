import {
  getDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

/** The wire surfaces the machine pages read: machine usage plus cross-slice pickers. */
export type MachinesPageWireClient = Pick<
  DesktopWireClient,
  'conversations' | 'machines' | 'projects' | 'tasks'
>;

export async function getMachinesPageWireClient(): Promise<MachinesPageWireClient> {
  return await getDesktopWireClient();
}
