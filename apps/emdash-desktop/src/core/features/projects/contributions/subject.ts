import { defineSubject } from '@core/primitives/subjects/api';
import { z } from 'zod';

export const projectSubject = defineSubject({
  kind: 'project',
  key: z.object({ projectId: z.string().min(1) }),
  encode: ({ projectId }) => projectId,
});
