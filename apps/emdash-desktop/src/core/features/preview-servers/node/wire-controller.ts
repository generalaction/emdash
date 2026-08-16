import { createController, type Controller } from '@emdash/wire/rpc';
import { previewServersContract } from '../api';
import { previewServerEvents } from './event-host';
import type { PreviewServerAccessOperations } from './preview-server-access-service';

export function createPreviewServersWireController(
  service: PreviewServerAccessOperations
): Controller {
  return createController(previewServersContract, {
    listForWorkspace: (input) => service.listForWorkspace(input),
    forwardManual: (input) => service.forwardManual(input),
    restart: (input) => service.restart(input),
    stop: (input) => service.stop(input),
    events: previewServerEvents,
  });
}
