import type { MobileAccessClient, MobileAccessStatus } from '@shared/core/mobile-access';
import { defineEvent } from '@shared/lib/ipc/events';

export const mobileAccessStatusChangedChannel = defineEvent<MobileAccessStatus>(
  'mobile-access:status-changed'
);

export const mobileAccessClientsChangedChannel = defineEvent<MobileAccessClient[]>(
  'mobile-access:clients-changed'
);
