import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type EditorClient = DesktopWireClient['editor'];

export async function getEditorClient(): Promise<EditorClient> {
  return (await getDesktopWireClient()).editor;
}

export function resetEditorClient(): void {
  resetDesktopWireClient();
}
