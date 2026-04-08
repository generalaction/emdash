import { defineEvent } from '@shared/ipc/events';

export const taskStatusUpdatedChannel = defineEvent<{
  taskId: string;
  projectId: string;
  status: string;
}>('task:status-updated');
