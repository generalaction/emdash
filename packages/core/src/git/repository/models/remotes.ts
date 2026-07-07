import { z } from 'zod';
import { gitRemoteSchema } from './refs';

export const gitRemotesModelSchema = z.object({
  remotes: z.array(gitRemoteSchema),
});
export type GitRemotesModel = z.infer<typeof gitRemotesModelSchema>;
