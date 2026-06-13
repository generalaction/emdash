import { externalLinkOpenRequestedChannel } from '@shared/events/appEvents';
import { events } from './ipc';
import { confirmOpenExternalLink } from './open-external-link';

export function wireExternalLinkRequests(): void {
  events.on(externalLinkOpenRequestedChannel, ({ url }) => {
    confirmOpenExternalLink(url);
  });
}
