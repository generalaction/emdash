import { events } from '@main/lib/events';
import { previewServerEventChannel } from '@shared/core/preview-servers/events';
import { PreviewServerService } from './preview-server-service';

export const previewServerService = new PreviewServerService({
  emit: (event) => events.emit(previewServerEventChannel, event),
});
