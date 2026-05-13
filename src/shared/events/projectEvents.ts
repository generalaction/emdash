import { defineEvent } from '@shared/ipc/events';

export const projectSettingsChangedChannel = defineEvent<{
  projectId: string;
}>('project:settings-changed');
