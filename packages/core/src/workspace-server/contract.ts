import { oc } from '@orpc/contract';
import { z } from 'zod';
import { clientHelloSchema, serverHelloSchema } from './versions/schemas';

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

  initialize: oc
    .input(clientHelloSchema)
    .errors({
      PROTOCOL_INCOMPATIBLE: {
        data: z.object({
          action: z.enum(['upgrade-client', 'upgrade-server']),
          clientProtocolVersion: z.string(),
          serverProtocolVersion: z.string(),
        }),
      },
    })
    .output(serverHelloSchema),
};

export type WorkspaceContract = typeof workspaceContract;
