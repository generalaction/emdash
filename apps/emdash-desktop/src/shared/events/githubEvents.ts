import type { GitHubUser } from '@shared/github';
import { defineEvent } from '@shared/lib/ipc/events';

export const githubAuthDeviceCodeChannel = defineEvent<{
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}>('github:auth:device-code');

export const githubAuthSuccessChannel = defineEvent<{
  user: GitHubUser;
}>('github:auth:success');

export const githubAuthErrorChannel = defineEvent<{
  error: string;
  message: string;
}>('github:auth:error');

export const githubAccountsChangedChannel = defineEvent<{
  reason: 'startup-reconciliation' | 'account-updated';
}>('github:accounts-changed');
