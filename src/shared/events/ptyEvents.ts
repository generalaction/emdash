import { defineEvent } from '@shared/ipc/events';

export const ptyDataChannel = defineEvent<string>('pty:output');

export const ptyExitChannel = defineEvent<{
  exitCode: number;
  signal?: number;
}>('pty:exit');

export const ptyInputChannel = defineEvent<string>('pty:input');
