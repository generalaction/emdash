import { createController, type Controller } from '@emdash/wire/api';
import { previewServerService } from '@core/features/preview-servers/api/node/preview-server-service-instance';
import { previewServersContract } from '../api';
import { previewServerEvents } from './event-host';

export function createPreviewServersWireController(): Controller {
  return createController(previewServersContract, {
    listForWorkspace: async (input) => previewServerService.listForWorkspace(input),
    forwardManual: async (input) => previewServerService.forwardManual(input),
    restart: async ({ id }) => {
      await previewServerService.restart(id);
    },
    stop: async ({ id }) => {
      await previewServerService.stop(id);
    },
    events: previewServerEvents,
  });
}
