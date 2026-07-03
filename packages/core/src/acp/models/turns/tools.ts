import { z } from 'zod';

export const toolStatusSchema = z.enum(['running', 'done', 'error']);
export type ToolStatus = z.infer<typeof toolStatusSchema>;

export const toolCallGroupKindSchema = z.enum(['read-batch', 'nested']);
export type ToolCallGroupKind = z.infer<typeof toolCallGroupKindSchema>;

export const toolCallLinkFieldsSchema = z.object({
  /** Transcript item id of the parent tool/subagent, for nested tool rendering. */
  parentId: z.string().optional(),
  /** Transcript item ids of child tool calls/groups owned by this item. */
  childIds: z.array(z.string()).optional(),
});
