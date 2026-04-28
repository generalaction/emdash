import { defineEvent } from '@shared/ipc/events';
import type { PullRequest } from '@shared/pull-requests';

export const taskStatusUpdatedChannel = defineEvent<{
  taskId: string;
  projectId: string;
  status: string;
}>('task:status-updated');

export const taskPrUpdatedChannel = defineEvent<{
  taskId: string;
  projectId: string;
  workspaceId: string;
  prs: PullRequest[];
}>('task:pr-updated');

export const taskProvisionProgressChannel = defineEvent<{
  taskId: string;
  projectId: string;
  step:
    | 'resolving-worktree'
    | 'initialising-workspace'
    | 'running-provision-script'
    | 'connecting'
    | 'setting-up-workspace'
    | 'starting-sessions';
  message: string;
}>('task:provision-progress');
