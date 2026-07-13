import { z } from 'zod';

export const gitStashSchema = z.object({
  index: z.number().int().nonnegative(),
  ref: z.string(),
  branch: z.string().optional(),
  message: z.string(),
  oid: z.string(),
  createdAt: z.number().int(),
});

export const gitStashesStateSchema = z.object({ stashes: z.array(gitStashSchema) });
export type GitStash = z.infer<typeof gitStashSchema>;
export type GitStashesState = z.infer<typeof gitStashesStateSchema>;
