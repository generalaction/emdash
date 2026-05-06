import type { HostPreviewEvent } from '@shared/hostPreview';
import { defineEvent } from '@shared/ipc/events';

export const hostPreviewEventChannel = defineEvent<HostPreviewEvent>('preview:host:event');
