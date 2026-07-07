import { z } from 'zod';
import { defineLiveMutations, liveModelRef } from '../../src/live/mutations/index';

export const treeKeySchema = z.object({
  rootPath: z.string(),
  sessionId: z.string(),
});

export const treeSchema = z.object({
  files: z.record(z.string(), z.string()),
});

export const renameInputSchema = z.object({
  rootPath: z.string(),
  from: z.string(),
  to: z.string(),
});

export const treeRef = liveModelRef('files.tree', treeKeySchema, treeSchema);

export const fileMutationDefs = defineLiveMutations({
  rename: {
    input: renameInputSchema,
    error: z.string(),
    data: z.object({ renamed: z.boolean() }),
  },
});

export type TreeKey = z.infer<typeof treeKeySchema>;
export type TreeState = z.infer<typeof treeSchema>;
export type RenameInput = z.infer<typeof renameInputSchema>;

export function renameInTree(tree: TreeState, from: string, to: string): void {
  const content = tree.files[from];
  if (content === undefined) return;
  delete tree.files[from];
  tree.files[to] = content;
}
