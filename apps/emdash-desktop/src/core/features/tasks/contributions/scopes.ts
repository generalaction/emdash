import { z } from 'zod';
import { defineViewScope } from '@core/primitives/view-scopes/api';
import { TASK_COMMAND_DEFS } from './commands';

export const taskViewScope = defineViewScope({
  id: 'view.task',
  params: z.object({
    projectId: z.string().min(1),
    taskId: z.string().min(1),
  }),
  commands: TASK_COMMAND_DEFS,
  activation: 'logical',
  key: ({ projectId, taskId }) => `${projectId}:${taskId}`,
});
