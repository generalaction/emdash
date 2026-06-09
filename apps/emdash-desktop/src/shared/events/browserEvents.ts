import { defineEvent } from '@shared/lib/ipc/events';

export const browserOpenInNewTabChannel = defineEvent<{
  sourceBrowserId: string;
  url: string;
}>('browser:open-in-new-tab');
