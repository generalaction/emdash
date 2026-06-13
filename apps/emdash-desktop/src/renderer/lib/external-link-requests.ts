import { externalLinkOpenRequestedChannel } from '@shared/events/appEvents';
import { events } from './ipc';
import { confirmOpenExternalLink } from './open-external-link';

export function wireExternalLinkRequests() {
  return events.on(externalLinkOpenRequestedChannel, ({ url }) => {
    confirmOpenExternalLink(url);
  });
}
