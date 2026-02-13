import { useCallback, useEffect, useState } from 'react';
import { CliAgentStatus } from '../types/connections';
import { BASE_CLI_AGENTS } from '../components/CliAgentsList';

type CachedAgentStatus = {
  installed: boolean;
  path?: string | null;
  version?: string | null;
  lastChecked?: number;
};

const createDefaultCliAgents = (): CliAgentStatus[] =>
  BASE_CLI_AGENTS.map((agent) => ({ ...agent }));

const mergeCliAgents = (incoming: CliAgentStatus[]): CliAgentStatus[] => {
  const mergedMap = new Map<string, CliAgentStatus>();

  BASE_CLI_AGENTS.forEach((agent) => {
    mergedMap.set(agent.id, { ...agent });
  });

  incoming.forEach((agent) => {
    mergedMap.set(agent.id, {
      ...(mergedMap.get(agent.id) ?? {}),
      ...agent,
    });
  });

  return Array.from(mergedMap.values());
};

const mapAgentStatusesToCli = (
  statuses: Record<string, CachedAgentStatus | undefined>
): CliAgentStatus[] => {
  return Object.entries(statuses).reduce<CliAgentStatus[]>((acc, [agentId, status]) => {
    if (!status) return acc;
    const base = BASE_CLI_AGENTS.find((agent) => agent.id === agentId);
    acc.push({
      ...(base ?? {
        id: agentId,
        name: agentId,
        status: 'missing' as const,
        docUrl: null,
        installCommand: null,
      }),
      id: agentId,
      name: base?.name ?? agentId,
      status: status.installed ? 'connected' : 'missing',
      version: status.version ?? null,
      command: status.path ?? null,
    });
    return acc;
  }, []);
};

export function useCliAgentDetection() {
  const [cliAgents, setCliAgents] = useState<CliAgentStatus[]>(() => createDefaultCliAgents());
  const [cliError, setCliError] = useState<string | null>(null);
  const [cliLoading, setCliLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;

    const applyCachedStatuses = (statuses: Record<string, CachedAgentStatus> | undefined) => {
      if (!statuses) return;
      const agents = mapAgentStatusesToCli(statuses);
      if (!agents.length) return;
      setCliAgents((prev) => mergeCliAgents([...prev, ...agents]));
    };

    const loadCachedStatuses = async () => {
      if (!window?.electronAPI?.getProviderStatuses) return;
      try {
        const result = await window.electronAPI.getProviderStatuses();
        if (cancelled) return;
        if (result?.success && result.statuses) {
          applyCachedStatuses(result.statuses);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load cached CLI agent statuses:', error);
        }
      }
    };

    const off =
      window?.electronAPI?.onProviderStatusUpdated?.(
        (payload: { providerId: string; status: CachedAgentStatus }) => {
          if (!payload?.providerId || !payload.status) return;
          applyCachedStatuses({ [payload.providerId]: payload.status });
        }
      ) ?? null;

    void loadCachedStatuses();

    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  const fetchCliAgents = useCallback(async () => {
    if (!window?.electronAPI?.getProviderStatuses) {
      setCliAgents(createDefaultCliAgents());
      setCliError('Agent status detection is unavailable in this build.');
      return;
    }

    setCliLoading(true);
    setCliError(null);

    try {
      const result = await window.electronAPI.getProviderStatuses({ refresh: true });
      if (result?.success && result.statuses) {
        const agents = mapAgentStatusesToCli(result.statuses);
        setCliAgents((prev) => mergeCliAgents([...prev, ...agents]));
      } else {
        setCliError(result?.error || 'Failed to detect CLI agents.');
      }
    } catch (error) {
      console.error('CLI detection failed:', error);
      setCliError('Unable to detect CLI agents.');
    } finally {
      setCliLoading(false);
    }
  }, []);

  return {
    cliAgents,
    cliLoading,
    cliError,
    fetchCliAgents,
  };
}
