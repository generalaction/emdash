import { z } from 'zod';

export const gitHeadModelSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('branch'), name: z.string(), oid: z.string() }),
  z.object({ kind: z.literal('detached'), shortHash: z.string(), oid: z.string() }),
  z.object({ kind: z.literal('unborn'), name: z.string() }),
]);

export type GitHeadModel = z.infer<typeof gitHeadModelSchema>;
