import type { FileChangeUpdate, FileNode, NodeId } from '@emdash/core/files';
import { defineEvent } from '@shared/lib/ipc/events';

export type FileChangesEvent = {
  projectId: string;
  workspaceId: string;
  update: FileChangeUpdate;
};

export const fileChangesChannel = defineEvent<FileChangesEvent>('files:changes');

/** A whole, current listing of a single directory scope (children of `scopeId`; root is `null`). */
export type FileTreeProjectionScope = {
  scopeId: NodeId | null;
  entries: FileNode[];
};

/**
 * A per-view projection update: the main-process projector pushes the current contents of one or
 * more directory scopes that the subscription has registered. `version` is monotonic per
 * subscription and is what the renderer waits on for read-your-writes.
 */
export type FileTreeProjectionEvent = {
  projectId: string;
  workspaceId: string;
  subscriptionId: string;
  version: number;
  scopes: FileTreeProjectionScope[];
};

export const fileTreeProjectionChannel =
  defineEvent<FileTreeProjectionEvent>('fs:file-tree-projection');
