import { z } from 'zod';
import { toolCallGroupKindSchema, toolCallLinkFieldsSchema, toolStatusSchema } from './tools';

export const transcriptToolGroupSnapshotSchema = z
  .object({
    kind: z.literal('tool-group'),
    id: z.string(),
    label: z.string(),
    groupKind: toolCallGroupKindSchema,
    childIds: z.array(z.string()),
    status: toolStatusSchema,
  })
  .merge(toolCallLinkFieldsSchema.omit({ childIds: true }));
export type TranscriptToolGroupSnapshot = z.infer<typeof transcriptToolGroupSnapshotSchema>;
