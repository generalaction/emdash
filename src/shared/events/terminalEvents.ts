import { defineEvent } from '@shared/ipc/events';
import type { Terminal } from '@shared/terminals';

/**
 * Broadcast when a terminal is created outside the current renderer flow so
 * the task UI can add and attach it immediately.
 */
export const terminalCreatedChannel = defineEvent<Terminal>('terminal:created');

/**
 * Broadcast when terminal metadata changes (currently rename).
 */
export const terminalUpdatedChannel = defineEvent<Terminal>('terminal:updated');

/**
 * Broadcast when a terminal is deleted externally so open drawers remove it.
 */
export const terminalDeletedChannel = defineEvent<{
  terminalId: string;
  taskId: string;
  projectId: string;
}>('terminal:deleted');
