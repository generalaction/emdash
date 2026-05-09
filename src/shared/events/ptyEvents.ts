import { defineEvent } from '@shared/ipc/events';

// 'pty:data' matches the channel name consumed by TerminalSessionManager.
export const ptyDataChannel = defineEvent<string>('pty:data');

export const ptyExitChannel = defineEvent<{
  exitCode: number;
  signal?: number;
}>('pty:exit');

export const ptyInputChannel = defineEvent<string>('pty:input');
