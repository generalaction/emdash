import { hostRefSchema } from '@emdash/core/primitives/host/api';
import { hostAbsolutePathSchema } from '@emdash/core/primitives/path/api';
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
} from '@emdash/core/runtimes/lsp/api';
import { defineContract, fallible, liveModel, liveState } from '@emdash/wire/rpc';
import { z } from 'zod';

export const editorLspSessionSchema = lspSessionKeySchema.extend({ host: hostRefSchema });
const query = lspQuerySchema.extend({ session: editorLspSessionSchema });
const documentKey = z.object({ session: editorLspSessionSchema, path: hostAbsolutePathSchema });

/** Host identity is carried once per session; all result paths belong to that host. */
export const editorLspContract = defineContract({
  resolveProjectRoot: fallible({
    input: lspProjectRootQuerySchema.extend({ host: hostRefSchema }),
    data: hostAbsolutePathSchema,
    error: lspErrorSchema,
  }),
  applyDocumentEdit: fallible({
    input: z.object({ session: editorLspSessionSchema, change: lspDocumentChangeSchema }),
    data: z.void(),
    error: lspErrorSchema,
  }),
  session: liveModel({
    key: editorLspSessionSchema,
    states: { current: liveState({ data: lspStateSchema }) },
  }),
  setDocumentSnapshot: fallible({
    input: z.object({ session: editorLspSessionSchema, document: lspDocumentSchema }),
    data: z.void(),
    error: lspErrorSchema,
  }),
  closeDocument: fallible({ input: documentKey, data: z.void(), error: lspErrorSchema }),
  documentSaved: fallible({ input: documentKey, data: z.void(), error: lspErrorSchema }),
  restartServer: fallible({ input: editorLspSessionSchema, data: z.void(), error: lspErrorSchema }),
  hover: fallible({ input: query, data: lspHoverSchema, error: lspErrorSchema }),
  locations: fallible({
    input: query.extend({ kind: z.enum(['definition', 'typeDefinition', 'references']) }),
    data: z.array(lspLocationSchema),
    error: lspErrorSchema,
  }),
});
export type EditorLspSessionKey = z.infer<typeof editorLspSessionSchema>;
