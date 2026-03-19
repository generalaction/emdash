import { defineEvent } from '@shared/ipc/events';

export const editorFileExternallyChangedChannel = defineEvent<{
  projectId: string;
  taskId: string;
  filePath: string;
  newContent: string;
}>('editor:file-externally-changed');
