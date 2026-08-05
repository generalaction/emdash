import { useQuery } from '@tanstack/react-query';
import type { Project } from '@core/primitives/projects/api';
import type {
  GetProjectWorkspaceGitStatsResult,
  MeasureProjectWorkspacesResult,
  ProjectWorkspaceRow,
} from '@core/primitives/workspaces/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { appState } from '@renderer/lib/stores/app-state';

export interface MachineProjectWorkspaces {
  project: {
    id: string;
    name: string;
  };
  workspaces: ProjectWorkspaceRow[];
  warnings: string[];
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
      const projectList = await client.projects.projectList.state(undefined, 'list').snapshot();
      const projects = projectList.data.projects.filter((project) => project.type === 'local');
      return await listProjectWorkspaceGroups(projects);
    },
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export function useProjectWorkspaceUsage(
  projectId: string | undefined,
  paths: readonly string[],
  enabled: boolean
) {
  return useQuery({
    queryKey: ['projectWorkspaceUsage', projectId, paths],
    queryFn: async (): Promise<MeasureProjectWorkspacesResult> => {
      if (!projectId) return { scannedAt: new Date().toISOString(), projectId: '', results: [] };
      const client = await getDesktopWireClient();
      return await client.projectWorkspaces.measureProjectWorkspaces({
        projectId,
        paths: Array.from(paths),
      });
    },
    enabled: enabled && !!projectId && paths.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export function useProjectWorkspaceGitStats(
  projectId: string | undefined,
  paths: readonly string[],
  enabled: boolean
) {
  return useQuery({
    queryKey: ['projectWorkspaceGitStats', projectId, paths],
    queryFn: async (): Promise<GetProjectWorkspaceGitStatsResult> => {
      if (!projectId) return { scannedAt: new Date().toISOString(), projectId: '', results: [] };
      const client = await getDesktopWireClient();
      return await client.projectWorkspaces.getProjectWorkspaceGitStats({
        projectId,
        paths: Array.from(paths),
      });
    },
    enabled: enabled && !!projectId && paths.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}

export async function deleteMachineProjectWorkspaces({
  projectId,
  paths,
  deleteConversations,
}: {
  projectId: string;
  paths: string[];
  deleteConversations?: boolean;
}) {
  return (await getDesktopWireClient()).projectWorkspaces.deleteProjectWorkspaces({
    projectId,
    paths,
    deleteConversations,
  });
}

export async function getMachineOperationsClient() {
  return (await getDesktopWireClient()).operations;
}

// The workspaces lists do not show disk usage, so skip the expensive per-file
// measurement scan and only run the cheap listing. The project detail page
// fetches usage separately via useProjectWorkspaceUsage.
async function listProjectWorkspaceGroups(
  projects: Array<Pick<Project, 'id' | 'name'>>
): Promise<MachineProjectWorkspaces[]> {
  const client = await getDesktopWireClient();
  const groups = await Promise.all(
    projects.map(async (project) => {
      const listed = await client.projectWorkspaces.listProjectWorkspaces({
        projectId: project.id,
      });
      return { project, workspaces: listed.rows, warnings: listed.warnings };
    })
  );

  return groups.sort((left, right) => left.project.name.localeCompare(right.project.name));
}
