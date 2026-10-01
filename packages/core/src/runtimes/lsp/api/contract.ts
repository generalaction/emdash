import { defineContract, fallible, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';
import { hostAbsolutePathSchema } from '#primitives/path/api';
import {
  lspDocumentSchema,
  lspErrorSchema,
  lspHoverSchema,
  lspLocationSchema,
  lspQuerySchema,
  lspSessionKeySchema,
  lspStateSchema,
} from './schemas';

const documentKey = z.object({ session: lspSessionKeySchema, path: hostAbsolutePathSchema });
export const lspContract = defineContract({
  session: liveModel({
    key: lspSessionKeySchema,
    states: { current: liveState({ data: lspStateSchema }) },
  }),
  syncDocument: fallible({
    input: z.object({ session: lspSessionKeySchema, document: lspDocumentSchema }),
    data: z.void(),
    error: lspErrorSchema,
  }),
  closeDocument: fallible({ input: documentKey, data: z.void(), error: lspErrorSchema }),
  saved: fallible({ input: documentKey, data: z.void(), error: lspErrorSchema }),
  restart: fallible({ input: lspSessionKeySchema, data: z.void(), error: lspErrorSchema }),
  hover: fallible({ input: lspQuerySchema, data: lspHoverSchema, error: lspErrorSchema }),
  locations: fallible({
    input: lspQuerySchema.extend({ kind: z.enum(['definition', 'typeDefinition', 'references']) }),
    data: z.array(lspLocationSchema),
    error: lspErrorSchema,
  }),
});
export type LspContract = typeof lspContract;
