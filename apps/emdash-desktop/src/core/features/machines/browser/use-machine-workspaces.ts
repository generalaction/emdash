import { useQuery } from '@tanstack/react-query';
import type { ProjectWorkspace } from '@core/primitives/workspaces/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

export interface MachineProjectWorkspaces {
  project: {
    id: string;
    name: string;
  };
  workspaces: ProjectWorkspace[];
}

export function useMachineWorkspaces(machineId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['machineWorkspaces', machineId],
    queryFn: async (): Promise<MachineProjectWorkspaces[]> => {
      if (!machineId) return [];

      const client = await getDesktopWireClient();
      const usage = await client.machines.getMachineUsage(undefined);
      const projects = usage[machineId] ?? [];
      const groups = await Promise.all(
        projects.map(async (project) => ({
          project,
          workspaces: await client.tasks.getProjectWorkspaces({ projectId: project.id }),
        }))
      );

      return groups.sort((left, right) => left.project.name.localeCompare(right.project.name));
    },
    enabled: enabled && !!machineId,
    refetchOnWindowFocus: false,
  });
}
