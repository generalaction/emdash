import { defineContract, fallible, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';
import { hostAbsolutePathSchema } from '#primitives/path/api';
import {
  lspDocumentSchema,
  lspDocumentChangeSchema,
  lspProjectRootQuerySchema,
  lspErrorSchema,
  lspHoverSchema,
  lspLocationSchema,
  lspQuerySchema,
  lspSessionKeySchema,
  lspStateSchema,
} from './schemas';

const documentKey = z.object({ session: lspSessionKeySchema, path: hostAbsolutePathSchema });

export const lspContract = defineContract({
  resolveProjectRoot: fallible({
    input: lspProjectRootQuerySchema,
    data: hostAbsolutePathSchema,
    error: lspErrorSchema,
  }),
  applyDocumentEdit: fallible({
    input: z.object({ session: lspSessionKeySchema, change: lspDocumentChangeSchema }),
    data: z.void(),
    error: lspErrorSchema,
  }),
  session: liveModel({
    key: lspSessionKeySchema,
    states: { current: liveState({ data: lspStateSchema }) },
  }),
  setDocumentSnapshot: fallible({
    input: z.object({ session: lspSessionKeySchema, document: lspDocumentSchema }),
    data: z.void(),
    error: lspErrorSchema,
  }),
  closeDocument: fallible({ input: documentKey, data: z.void(), error: lspErrorSchema }),
  documentSaved: fallible({ input: documentKey, data: z.void(), error: lspErrorSchema }),
  restartServer: fallible({ input: lspSessionKeySchema, data: z.void(), error: lspErrorSchema }),
  hover: fallible({ input: lspQuerySchema, data: lspHoverSchema, error: lspErrorSchema }),
  locations: fallible({
    input: lspQuerySchema.extend({ kind: z.enum(['definition', 'typeDefinition', 'references']) }),
    data: z.array(lspLocationSchema),
    error: lspErrorSchema,
  }),
});

export type LspContract = typeof lspContract;
