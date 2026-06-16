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

/**
 * Emitted around a loadSession replay so the renderer can reset the transcript
 * before replay arrives and finalize streaming when it ends.
 * `start` fires before the loadSession call; `end` fires after it resolves.
 */
export const acpSessionReplayChannel = defineEvent<{
  conversationId: string;
  phase: 'start' | 'end';
}>('acp:session-replay');

/**
 * Emitted by the main process to report ACP session lifecycle readiness.
 * `starting` fires when the session setup begins; `ready` fires once the
 * agent has a live session and can accept prompts.
 */
export const acpSessionStatusChannel = defineEvent<{
  conversationId: string;
  status: 'starting' | 'ready';
}>('acp:session-status');
