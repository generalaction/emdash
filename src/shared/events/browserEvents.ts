import { defineEvent } from '@shared/ipc/events';

export const browserOpenInNewTabChannel = defineEvent<{
  sourceBrowserId: string;
  url: string;
}>('browser:open-in-new-tab');
