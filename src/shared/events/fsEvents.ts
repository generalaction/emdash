import type { FileWatchEvent } from '@shared/fs';
import { defineEvent } from '@shared/ipc/events';

export const fsWatchEventChannel = defineEvent<{
  projectId: string;
  workspaceId: string;
  events: FileWatchEvent[];
}>('fs:watch-event');
