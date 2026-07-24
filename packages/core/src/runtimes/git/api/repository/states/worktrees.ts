import { hostAbsolutePathSchema } from '@primitives/path/api';
import { z } from 'zod';

export const worktreeHeadSummarySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('branch'), name: z.string() }),
  z.object({ kind: z.literal('detached') }),
  z.object({ kind: z.literal('unborn'), name: z.string() }),
]);
export type WorktreeHeadSummary = z.infer<typeof worktreeHeadSummarySchema>;

export const worktreeSummarySchema = z.object({
  worktreePath: hostAbsolutePathSchema,
  isMain: z.boolean(),
  head: worktreeHeadSummarySchema,
  locked: z.boolean().optional(),
  prunable: z.boolean().optional(),
});
export type WorktreeSummary = z.infer<typeof worktreeSummarySchema>;

export const gitWorktreesStateSchema = z.array(worktreeSummarySchema);
export type GitWorktreesState = z.infer<typeof gitWorktreesStateSchema>;
