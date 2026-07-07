import { LiveModelClient } from '../../src/live/model/index';
import {
  LiveBindingRegistry,
  createLiveMutationsClient,
  type LiveMutationCaller,
} from '../../src/live/mutations/index';
import { treeSchema, type TreeKey, type TreeState } from './models';
import {
  attachTree,
  callFileMutation,
  fetchTreeSnapshot,
  fileMutationDefs,
  sessionA,
  sessionB,
  treeRef,
} from './server';

async function main(): Promise<void> {
  const bindings = new LiveBindingRegistry();

  const left = await bindTree(sessionA, bindings, 'left-pane');
  const right = await bindTree(sessionB, bindings, 'right-pane');

  const caller: LiveMutationCaller<typeof fileMutationDefs> = async (name, input) =>
    callFileMutation(name, input);
  const mutations = createLiveMutationsClient(fileMutationDefs, caller, bindings);

  const invocation = await mutations.rename({
    rootPath: '/repo',
    from: 'src/old.ts',
    to: 'src/new.ts',
  });

  if (!invocation.result.success) {
    throw new Error(invocation.result.error);
  }

  console.log('mutation cursors:', invocation.result.data.cursors);
  await invocation.settled;
  console.log('settled left tree:', left.client.getSnapshot());
  console.log('settled right tree:', right.client.getSnapshot());

  left.dispose();
  right.dispose();
}

async function bindTree(
  key: TreeKey,
  bindings: LiveBindingRegistry,
  label: string
): Promise<{
  client: LiveModelClient<TreeState>;
  dispose: () => void;
}> {
  const client = new LiveModelClient(
    treeSchema,
    () => fetchTreeSnapshot(key),
    (value) => {
      console.log(`${label} tree:`, value);
    }
  );
  client.seed(await fetchTreeSnapshot(key));
  const unregister = bindings.register(treeRef, key, client);
  const detach = attachTree(key, (update) => client.applyUpdate(update));

  return {
    client,
    dispose: () => {
      detach();
      unregister();
    },
  };
}

void main();
