import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import type { McpServer } from '@emdash/core/primitives/mcp/api';
import { createLiveModelReplica } from '@emdash/wire';
import { useEffect, useState } from 'react';
import { getMcpClient } from '@core/features/mcp/api/browser/client';
import { mcpContract } from '../api';

export function useInstalledMcpServersLiveModel(host: HostRef = LOCAL_HOST_REF): {
  data: McpServer[];
  isLoading: boolean;
} {
  const [data, setData] = useState<McpServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const client = await getMcpClient();
      if (disposed) return;
      const replica = createLiveModelReplica(mcpContract.servers, client.servers, {
        onChange: {
          list: (list: McpServer[]) => setData(list),
        },
      });
      const lease = replica.acquire({ host });
      cleanup = () => {
        void lease.release();
        void replica.dispose();
      };
      const model = await lease.ready();
      if (disposed) {
        cleanup();
        return;
      }
      setData((await model.states.list.snapshot()).data as McpServer[]);
      setIsLoading(false);
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [host]);

  return { data, isLoading };
}
