import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';
import { taskSubject } from './subject';

export const taskViewLocationSchema = z.object({
  tabId: z.string(),
});

export const taskViewDef = defineView({
  id: 'task',
  params: z.object({
    projectId: z.string(),
    taskId: z.string(),
  }),
  layout: workbenchLayout,
  historyKey: ({ taskId }) => taskId,
  subject: ({ taskId }) => taskSubject({ taskId }),
  location: {
    schema: taskViewLocationSchema,
    key: ({ tabId }) => tabId,
  },
  telemetryEvent: 'task_viewed',
});
