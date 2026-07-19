import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type ConversationsClient = DesktopWireClient['conversations'];

export async function getConversationsClient(): Promise<ConversationsClient> {
  return (await getDesktopWireClient()).conversations;
}

export function resetConversationsClient(): void {
  resetDesktopWireClient();
}
