import { resourceUriSchema } from '@emdash/core/primitives/path/api';
import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import { editorLspContract } from './lsp-contract';

const editorBufferKeySchema = z.object({ uri: resourceUriSchema });

export const editorDomain = 'editor' as const;

// The editor owns crash recovery and language services. File content and disk
// mutations remain in the files domain.
export const editorContract = defineContract({
  lsp: editorLspContract,
  saveBuffer: procedure({
    input: editorBufferKeySchema.extend({ content: z.string() }),
    output: z.void(),
  }),
  clearBuffer: procedure({
    input: editorBufferKeySchema,
    output: z.void(),
  }),
  // Recovery enumeration: `root` scopes to buffers under that root ResourceUri
  // prefix; omitting it lists every buffer, including files outside any root.
  listBuffers: procedure({
    input: z.object({ root: resourceUriSchema.optional() }),
    output: z.array(z.object({ uri: resourceUriSchema, content: z.string() })),
  }),
});

export type EditorContract = typeof editorContract;
