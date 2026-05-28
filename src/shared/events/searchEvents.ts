import { defineEvent } from '@shared/ipc/events';

export const workspaceFileIndexUpdatedChannel = defineEvent<{
  workspaceId: string;
}>('search:workspace-file-index-updated');
