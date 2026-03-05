import { defineEvent } from '@shared/ipc/events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const hostPreviewEventChannel = defineEvent<any>('preview:host:event');
