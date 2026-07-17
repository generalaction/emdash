import { previewServerEvents } from '@core/features/preview-servers/node';
import { PreviewServerService } from './preview-server-service';

export const previewServerService = new PreviewServerService({
  emit: (event) => previewServerEvents.emit(undefined, event),
});
