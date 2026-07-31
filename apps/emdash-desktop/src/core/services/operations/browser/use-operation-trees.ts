import type { OperationTree, OperationTreeList } from '@emdash/core/primitives/operations/api';
import { createLiveModelReplica, type LiveModelClientHandle } from '@emdash/wire';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { operationsContract, type OperationsContract } from '@core/services/operations/api';

type OperationMutationResponse = { success: true } | { success: false; error: { message: string } };

export type OperationTreesClient = {
  operationTrees: LiveModelClientHandle<OperationsContract['operationTrees']>;
  retry(input: { operationId: string }): Promise<OperationMutationResponse>;
  forget(input: { operationId: string }): Promise<OperationMutationResponse>;
};

export function useOperationTrees(
  projectId: string,
  getClient: () => Promise<OperationTreesClient>
): {
  trees: OperationTree[];
  retry(operationId: string): Promise<void>;
  forget(operationId: string): Promise<void>;
} {
  const [treeList, setTreeList] = useState<OperationTreeList>({});

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const client = await getClient();
      if (disposed) return;
      const replica = createLiveModelReplica(
        operationsContract.operationTrees,
        client.operationTrees,
        {
          onChange: { list: (list: OperationTreeList) => setTreeList(list) },
        }
      );
      const lease = replica.acquire({ projectId });
      cleanup = () => {
        void lease.release();
        void replica.dispose();
      };
      const model = await lease.ready();
      if (disposed) {
        cleanup();
        return;
      }
      setTreeList((await model.states.list.snapshot()).data as OperationTreeList);
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [getClient, projectId]);

  const trees = useMemo(
    () => Object.values(treeList).sort((left, right) => left.root.createdAt - right.root.createdAt),
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

  return { trees, retry, forget };
}
