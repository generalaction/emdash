import {
  getDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type SkillsRpcClient = DesktopWireClient['skills'];

export async function getSkillsClient(): Promise<SkillsRpcClient> {
  return (await getDesktopWireClient()).skills;
}
