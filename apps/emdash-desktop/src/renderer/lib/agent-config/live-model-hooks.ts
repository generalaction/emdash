import type { McpServer } from '@emdash/core/primitives/mcp/api';
import type { CatalogSkill } from '@emdash/core/primitives/skills/api';
import { agentConfigContract } from '@emdash/core/runtimes/agent-config/api';
import { createLiveModelReplica } from '@emdash/wire';
import { useEffect, useState } from 'react';
import { getAgentConfigRuntimeClient } from './runtime-client';

export function useInstalledSkillsLiveModel(): {
  data: CatalogSkill[];
  isLoading: boolean;
} {
  const [data, setData] = useState<CatalogSkill[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const client = await getAgentConfigRuntimeClient();
      if (disposed) return;
      const replica = createLiveModelReplica(agentConfigContract.skills, client.skills, {
        onChange: {
          list: (list: CatalogSkill[]) => setData(list),
        },
      });
      const lease = replica.acquire(undefined);
      cleanup = () => {
        void lease.release();
        void replica.dispose();
      };
      const model = await lease.ready();
      if (disposed) {
        cleanup();
        return;
      }
      setData((await model.states.list.snapshot()).data as CatalogSkill[]);
      setIsLoading(false);
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return { data, isLoading };
}

export function useInstalledMcpServersLiveModel(): {
  data: McpServer[];
  isLoading: boolean;
} {
  const [data, setData] = useState<McpServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const client = await getAgentConfigRuntimeClient();
      if (disposed) return;
      const replica = createLiveModelReplica(agentConfigContract.mcpServers, client.mcpServers, {
        onChange: {
          list: (list: McpServer[]) => setData(list),
        },
      });
      const lease = replica.acquire(undefined);
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
  }, []);

  return { data, isLoading };
}
