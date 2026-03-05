import { defineEvent } from '@shared/ipc/events';
import type { HostPreviewEvent } from '@shared/types/hostPreview';

export const hostPreviewEventChannel = defineEvent<HostPreviewEvent>('preview:host:event');
