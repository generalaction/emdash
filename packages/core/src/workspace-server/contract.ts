import { oc } from '@orpc/contract';
import { z } from 'zod';

export const workspaceContract = {
  health: oc
    .input(z.object({}).optional())
    .output(
      z.object({
        status: z.literal('ok'),
        version: z.string(),
        uptimeMs: z.number(),
      })
    ),
};

export type WorkspaceContract = typeof workspaceContract;
