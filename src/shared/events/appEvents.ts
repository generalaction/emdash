import { defineEvent } from '@shared/ipc/events';

export const gitStatusChangedChannel = defineEvent<{
  taskPath: string;
  error?: string;
}>('git:status-changed');

export const notificationFocusTaskChannel = defineEvent<{
  taskId: string;
}>('notification:focus-task');

export const ptyStartedChannel = defineEvent<{
  id: string;
}>('pty:started');

export type PlanEvent = {
  type: 'write_blocked' | 'remove_blocked';
  root: string;
  relPath: string;
  code?: string;
  message?: string;
};

export const planEventChannel = defineEvent<PlanEvent>('plan:event');

export type ProviderStatus = {
  installed: boolean;
  path?: string | null;
  version?: string | null;
  lastChecked: number;
};

export const providerStatusUpdatedChannel = defineEvent<{
  providerId: string;
  status: ProviderStatus;
}>('provider:status-updated');

export const ptyDataChannel = defineEvent<string>('pty:data');

export const ptyExitChannel = defineEvent<{
  exitCode: number;
  signal?: number;
}>('pty:exit');
