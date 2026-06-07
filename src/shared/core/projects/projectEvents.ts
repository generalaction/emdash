import { defineEvent } from '@shared/lib/ipc/events';

export const projectSettingsChangedChannel = defineEvent<{
  projectId: string;
}>('project:settings-changed');
