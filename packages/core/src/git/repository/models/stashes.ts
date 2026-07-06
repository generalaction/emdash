import { z } from 'zod';

export const gitStashSchema = z.object({
  index: z.number().int().nonnegative(),
  ref: z.string(),
  message: z.string(),
  branch: z.string().optional(),
  oid: z.string(),
  createdAt: z.number().int(),
});

export const gitStashesModelSchema = z.object({
  stashes: z.array(gitStashSchema),
});
