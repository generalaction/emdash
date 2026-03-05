import { defineEvent } from '@shared/ipc/events';

export const githubAuthDeviceCodeChannel = defineEvent<{
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}>('github:auth:device-code');

export const githubAuthPollingChannel = defineEvent<{
  status: string;
}>('github:auth:polling');

export const githubAuthSlowDownChannel = defineEvent<{
  newInterval: number;
}>('github:auth:slow-down');

export const githubAuthSuccessChannel = defineEvent<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  token: string;
  user: any;
}>('github:auth:success');

export const githubAuthErrorChannel = defineEvent<{
  error: string;
  message: string;
}>('github:auth:error');

export const githubAuthCancelledChannel = defineEvent<void>('github:auth:cancelled');

export const githubAuthUserUpdatedChannel = defineEvent<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any;
}>('github:auth:user-updated');
