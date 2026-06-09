import type { FileWatchEvent } from '@shared/core/fs/fs';
import { defineEvent } from '@shared/lib/ipc/events';

export const fsWatchEventChannel = defineEvent<{
  projectId: string;
  workspaceId: string;
  events: FileWatchEvent[];
}>('fs:watch-event');
