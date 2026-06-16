import { defineEvent } from '@shared/lib/ipc/events';

export const browserOpenInNewTabChannel = defineEvent<{
  sourceBrowserId: string;
  url: string;
}>('browser:open-in-new-tab');

export const browserLinkCopiedChannel = defineEvent<{
  kind: 'image' | 'link' | 'url';
  url: string;
}>('browser:link-copied');
