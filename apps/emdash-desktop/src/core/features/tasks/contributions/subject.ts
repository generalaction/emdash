import { defineSubject } from '@core/primitives/subjects/api';
import { z } from 'zod';

export const taskSubject = defineSubject({
  kind: 'task',
  key: z.object({ taskId: z.string().min(1) }),
  encode: ({ taskId }) => taskId,
});
