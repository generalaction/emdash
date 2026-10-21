import { z } from 'zod';
import { defineSubject } from '@core/primitives/subjects/api';

export const conversationSubject = defineSubject({
  kind: 'conversation',
  key: z.object({ conversationId: z.string().min(1) }),
  encode: ({ conversationId }) => conversationId,
});
