import { createController, type Controller } from '@emdash/wire/api';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { previewServersContract } from '../api';
import { previewServerEvents } from './event-host';

export function createPreviewServersWireController(): Controller {
  return createController(previewServersContract, {
    listForWorkspace: async (input) => previewServerService.listForWorkspace(input),
    stop: async ({ id }) => {
      await previewServerService.stop(id);
    },
    events: previewServerEvents,
  });
}
