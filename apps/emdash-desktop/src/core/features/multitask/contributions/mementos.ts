import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
import { defineMemento } from '@core/primitives/mementos/api';
import { appSubject } from '@core/primitives/subjects/api';

const multitaskCellV1Schema = z.object({
  projectId: z.string(),
  taskId: z.string(),
  conversationId: z.string(),
});

const multitaskLayoutV1Schema = z.object({
  version: z.literal('1'),
  cells: z.array(multitaskCellV1Schema),
  columns: z.number().int().min(1).max(4),
  liveOnly: z.boolean(),
});

export const multitaskLayoutSchema = defineVersionedSchema()
  .initial('1', multitaskLayoutV1Schema)
  .build();

export type MultitaskLayoutState = typeof multitaskLayoutSchema.Type;

export const multitaskLayoutMemento = defineMemento({
  id: 'multitask.layout',
  subject: appSubject,
  schema: multitaskLayoutSchema,
  default: {
    version: '1' as const,
    cells: [],
    columns: 2,
    liveOnly: true,
  },
});
