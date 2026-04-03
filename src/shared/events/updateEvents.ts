import type { UpdateInfo } from 'electron-updater';
import { defineEvent } from '@shared/ipc/events';

export const updateCheckingEvent = defineEvent<void>('update:checking');

export const updateAvailableEvent = defineEvent<{
  version: string;
  updateInfo: UpdateInfo;
}>('update:available');

export const updateNotAvailableEvent = defineEvent<void>('update:not-available');

export const updateDownloadingEvent = defineEvent<{ version: string }>('update:downloading');

export const updateProgressEvent = defineEvent<{
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}>('update:progress');

export const updateDownloadedEvent = defineEvent<{ version: string }>('update:downloaded');

export const updateInstallingEvent = defineEvent<void>('update:installing');

export const updateErrorEvent = defineEvent<{ message: string }>('update:error');
