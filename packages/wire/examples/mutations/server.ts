import { err, ok } from '@emdash/shared';
import type { Unsubscribe } from '@emdash/shared';
import { LiveModel } from '../../src/live/model/index';
import { LiveModelRegistry, liveMutation } from '../../src/live/mutations/index';
import type { LiveMutationResult } from '../../src/live/mutations/index';
import type { LiveSnapshot, LiveUpdate } from '../../src/live/protocol/index';
import {
  fileMutationDefs,
  renameInTree,
  treeRef,
  type RenameInput,
  type TreeKey,
  type TreeState,
} from './models';

const registry = new LiveModelRegistry();

const sessionA: TreeKey = { rootPath: '/repo', sessionId: 'left-pane' };
const sessionB: TreeKey = { rootPath: '/repo', sessionId: 'right-pane' };

const leftTree = new LiveModel<TreeState>(
  { files: { 'src/old.ts': 'export const name = "left";' } },
  5000
);
const rightTree = new LiveModel<TreeState>(
  { files: { 'src/old.ts': 'export const name = "right";' } },
  6000
);

registry.register(treeRef, sessionA, leftTree);
registry.register(treeRef, sessionB, rightTree);

const renameMutation = liveMutation<RenameInput, { renamed: boolean }, string>(
  registry,
  (ctx, input) => {
    ctx.produceAll(treeRef, { rootPath: input.rootPath }, (draft) => {
      renameInTree(draft, input.from, input.to);
    });
    return ok({ renamed: true });
  }
);

export { fileMutationDefs, sessionA, sessionB, treeRef };

export async function fetchTreeSnapshot(key: TreeKey): Promise<LiveSnapshot<TreeState>> {
  return resolveTree(key).snapshot();
}

export function attachTree(key: TreeKey, push: (update: LiveUpdate) => void): Unsubscribe {
  return resolveTree(key).subscribe(push);
}

export async function callFileMutation(
  name: keyof typeof fileMutationDefs,
  input: RenameInput & { mutationId?: string }
): Promise<LiveMutationResult<{ renamed: boolean }, string>> {
  if (name !== 'rename') return err(`Unknown mutation ${String(name)}`);
  return renameMutation(input);
}

function resolveTree(key: TreeKey): LiveModel<TreeState> {
  const model = registry.resolve(treeRef, key);
  if (!model) throw new Error(`Missing tree model for ${key.sessionId}`);
  return model;
}
