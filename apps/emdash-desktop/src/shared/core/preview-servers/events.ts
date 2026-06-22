import { defineEvent } from '@shared/lib/ipc/events';
import type { PreviewServerEvent } from './types';

export const previewServerEventChannel = defineEvent<PreviewServerEvent>('preview-server:event');
