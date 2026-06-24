import type { FileTreeUpdate } from '@emdash/core/files';
import type { FileChangeUpdate } from '@emdash/core/files';
import { defineEvent } from '@shared/lib/ipc/events';

export type FileChangesEvent = {
  projectId: string;
  workspaceId: string;
  update: FileChangeUpdate;
};

export const fileChangesChannel = defineEvent<FileChangesEvent>('files:changes');

export type FileTreeUpdateEvent = {
  projectId: string;
  workspaceId: string;
  update: FileTreeUpdate;
};

export const fileTreeUpdateChannel = defineEvent<FileTreeUpdateEvent>('fs:file-tree-update');
