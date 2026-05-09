import { defineEvent } from '@shared/ipc/events';

export type SshConnectionEvent =
  | { type: 'connecting'; connectionId: string }
  | { type: 'connected'; connectionId: string }
  | { type: 'disconnected'; connectionId: string }
  | { type: 'reconnecting'; connectionId: string; attempt: number; delayMs: number }
  | { type: 'reconnected'; connectionId: string }
  | { type: 'reconnect-failed'; connectionId: string }
  | { type: 'error'; connectionId: string; errorMessage: string };

export const sshConnectionEventChannel = defineEvent<SshConnectionEvent>('ssh:connection-event');
