import type { OperationTree } from '@emdash/core/primitives/operations/api';
import { remote, type LiveModelClientHandle, type RemoteModel } from '@emdash/wire';
import { useCallback, useMemo } from 'react';
import { useRemoteModelState } from '@core/primitives/wire/browser/use-remote-model-state';
import { operationsContract, type OperationsContract } from '@core/services/operations/api';

type OperationMutationResponse = { success: true } | { success: false; error: { message: string } };

export type OperationTreesClient = {
  operationTrees: LiveModelClientHandle<OperationsContract['operationTrees']>;
  retry(input: { operationId: string }): Promise<OperationMutationResponse>;
  forget(input: { operationId: string }): Promise<OperationMutationResponse>;
  cancel(input: { operationId: string }): Promise<OperationMutationResponse>;
};

type OperationTreesRemote = RemoteModel<typeof operationsContract.operationTrees>;
type GetOperationTreesClient = () => Promise<OperationTreesClient>;

const operationTreeRemotes = new Map<GetOperationTreesClient, Promise<OperationTreesRemote>>();

export function useOperationTrees(
  projectId: string,
  getClient: () => Promise<OperationTreesClient>
): {
  trees: OperationTree[];
  retry(operationId: string): Promise<void>;
  forget(operationId: string): Promise<void>;
  cancel(operationId: string): Promise<void>;
} {
  const key = useMemo(() => ({ projectId }), [projectId]);
  const treeListState = useRemoteModelState(
    operationsContract.operationTrees,
    () => getOperationTreesRemote(getClient),
    key,
    'list',
    { initialValue: {} }
  );
  const treeList = treeListState.value;

  const trees = useMemo(
    () =>
      Object.values(treeList ?? {}).sort(
        (left, right) => left.root.createdAt - right.root.createdAt
      ),
    [treeList]
  );

  const retry = useCallback(
    async (operationId: string) => {
      const result = await (await getClient()).retry({ operationId });
      if (!result.success) throw new Error(result.error.message);
    },
    [getClient]
  );

  const forget = useCallback(
    async (operationId: string) => {
      const result = await (await getClient()).forget({ operationId });
      if (!result.success) throw new Error(result.error.message);
    },
    [getClient]
  );

  const cancel = useCallback(
    async (operationId: string) => {
      const result = await (await getClient()).cancel({ operationId });
      if (!result.success) throw new Error(result.error.message);
    },
    [getClient]
  );

  return { trees, retry, forget, cancel };
}

function getOperationTreesRemote(
  getClient: GetOperationTreesClient
): Promise<OperationTreesRemote> {
  let remotePromise = operationTreeRemotes.get(getClient);
  if (!remotePromise) {
    remotePromise = getClient().then((client) =>
      remote(operationsContract.operationTrees, client.operationTrees, { lingerMs: 15_000 })
    );
    operationTreeRemotes.set(getClient, remotePromise);
  }
  return remotePromise;
}

export async function resetOperationTreeRemotesForTests(): Promise<void> {
  const remotes = [...operationTreeRemotes.values()];
  operationTreeRemotes.clear();
  await Promise.all(remotes.map(async (remoteModel) => (await remoteModel).dispose()));
}
