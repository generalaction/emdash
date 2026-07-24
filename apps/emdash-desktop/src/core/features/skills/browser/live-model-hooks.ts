import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import type { CatalogSkill } from '@emdash/core/primitives/skills/api';
import { createLiveModelReplica } from '@emdash/wire';
import { useEffect, useState } from 'react';
import { skillsContract } from '../api';
import { getSkillsClient } from './client';

export function useInstalledSkillsLiveModel(host: HostRef = LOCAL_HOST_REF): {
  data: CatalogSkill[];
  isLoading: boolean;
} {
  const [data, setData] = useState<CatalogSkill[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const client = await getSkillsClient();
      if (disposed) return;
      const replica = createLiveModelReplica(skillsContract.installed, client.installed, {
        onChange: {
          list: (list: CatalogSkill[]) => setData(list),
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
      setData((await model.states.list.snapshot()).data as CatalogSkill[]);
      setIsLoading(false);
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [host]);

  return { data, isLoading };
}
