import { useQuery } from '@tanstack/react-query';
import type { Project } from '@core/primitives/projects/api';
import type { ProjectWorkspaceRow, ProjectWorkspaceUsage } from '@core/primitives/workspaces/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { appState } from '@renderer/lib/stores/app-state';

export interface MachineProjectWorkspaces {
  project: {
    id: string;
    name: string;
  };
  workspaces: ProjectWorkspaceRow[];
}

export function useMachineWorkspaces(machineId: string | undefined, enabled: boolean) {
  const connected = machineId ? appState.machines.stateFor(machineId) === 'connected' : false;
  return useQuery({
    queryKey: ['machineWorkspaces', machineId],
    queryFn: async (): Promise<MachineProjectWorkspaces[]> => {
      if (!machineId) return [];

      const client = await getDesktopWireClient();
      const usage = await client.machines.getMachineUsage(undefined);
      const projects = usage[machineId] ?? [];
      return await listProjectWorkspaceGroups(projects);
    },
    enabled: enabled && connected && !!machineId,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export function useLocalWorkspaces(enabled: boolean) {
  return useQuery({
    queryKey: ['machineWorkspaces', 'local'],
    queryFn: async (): Promise<MachineProjectWorkspaces[]> => {
      const client = await getDesktopWireClient();
      const projects = (await client.projects.getProjects()).filter(
        (project) => project.type === 'local'
      );
      return await listProjectWorkspaceGroups(projects);
    },
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export async function deleteMachineProjectWorkspaces({
  projectId,
  paths,
}: {
  projectId: string;
  paths: string[];
}) {
  return (await getDesktopWireClient()).projectWorkspaces.deleteProjectWorkspaces({
    projectId,
    paths,
  });
}

async function listProjectWorkspaceGroups(
  projects: Array<Pick<Project, 'id' | 'name'>>
): Promise<MachineProjectWorkspaces[]> {
  const client = await getDesktopWireClient();
  const groups = await Promise.all(
    projects.map(async (project) => {
      const listed = await client.projectWorkspaces.listProjectWorkspaces({
        projectId: project.id,
      });
      const measured = await client.projectWorkspaces.measureProjectWorkspaces({
        projectId: project.id,
        paths: listed.rows.filter((row) => row.pathState === 'measured').map((row) => row.path),
      });
      const usageByPath = new Map<string, ProjectWorkspaceUsage>(
        measured.results.flatMap((result) =>
          result.success ? ([[result.path, result.usage]] as const) : []
        )
      );
      return {
        project,
        workspaces: listed.rows.map((row) => ({
          ...row,
          usage: usageByPath.get(row.path) ?? row.usage,
        })),
      };
    })
  );

  return groups.sort((left, right) => left.project.name.localeCompare(right.project.name));
}
