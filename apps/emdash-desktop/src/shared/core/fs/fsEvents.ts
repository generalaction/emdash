import type { FileTreeUpdate } from '@emdash/core/file-tree';
import type { FileWatchEvent } from '@shared/core/fs/fs';
import { defineEvent } from '@shared/lib/ipc/events';

export const fsWatchEventChannel = defineEvent<{
  projectId: string;
  workspaceId: string;
  events: FileWatchEvent[];
}>('fs:watch-event');

export type FileTreeUpdateEvent = {
  projectId: string;
  workspaceId: string;
  update: FileTreeUpdate;
};

export const fileTreeUpdateChannel = defineEvent<FileTreeUpdateEvent>('fs:file-tree-update');
