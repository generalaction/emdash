import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { defineEvent } from '@shared/lib/ipc/events';

/** Forwarded from the main process whenever the ACP agent emits a session/update notification. */
export const acpSessionUpdateChannel = defineEvent<{
  conversationId: string;
  update: SessionUpdate;
}>('acp:session-update');

/** Emitted when the ACP agent subprocess exits or the connection closes. */
export const acpSessionClosedChannel = defineEvent<{
  conversationId: string;
  exitCode: number | null;
}>('acp:session-closed');
