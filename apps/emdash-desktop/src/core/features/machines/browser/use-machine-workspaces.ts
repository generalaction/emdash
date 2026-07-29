import {
  isTerminalStatus,
  type WorkspaceOperationRecordMap,
} from '@emdash/core/runtimes/workspace/api';
import { createLiveModelReplica } from '@emdash/wire';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { machinesContract } from '@core/features/machines/api';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import type { Project } from '@core/primitives/projects/api';
import type {
  GetProjectWorkspaceGitStatsResult,
  MeasureProjectWorkspacesResult,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsage,
} from '@core/primitives/workspaces/api';
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
      // The local workspaces view does not show disk usage, so skip the
      // expensive per-file measurement scan and only run the cheap listing.
      return await listProjectWorkspaceGroups(projects, { measure: false });
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
}: {
  projectId: string;
  paths: string[];
}) {
  return (await getDesktopWireClient()).projectWorkspaces.deleteProjectWorkspaces({
    projectId,
    paths,
  });
}

export function useMachineOperationLog(machineId?: string): Map<string, string> {
  const [records, setRecords] = useState<WorkspaceOperationRecordMap>({});

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      try {
        const client = await getDesktopWireClient();
        if (disposed) return;
        const replica = createLiveModelReplica(
          machinesContract.operationLog,
          client.machines.operationLog,
          {
            onChange: { list: (list: WorkspaceOperationRecordMap) => setRecords(list) },
          }
        );
        const lease = replica.acquire({ machineId });
        let released = false;
        cleanup = () => {
          if (released) return;
          released = true;
          void lease.release();
          void replica.dispose();
        };
        const model = await lease.ready();
        if (disposed) {
          cleanup();
          return;
        }
        const snapshot = await model.states.list.snapshot();
        // The replica snapshot currently loses the live-state data generic at this boundary.
        setRecords(snapshot.data as WorkspaceOperationRecordMap);
      } catch {
        cleanup?.();
        if (!disposed) setRecords({});
      }
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [machineId]);

  return useMemo(() => {
    const active = new Map<string, string>();
    for (const record of Object.values(records)) {
      if (isTerminalStatus(record.status)) continue;
      active.set(nativePathFromHost(record.workspace.path), hostOperationLabel(record.kind));
    }
    return active;
  }, [records]);
}

function hostOperationLabel(kind: string): string {
  switch (kind) {
    case 'clean-artifacts':
      return 'Artifact cleanup in progress on this host';
    case 'teardown':
      return 'Cleanup in progress on this host';
    default:
      return 'Workspace operation in progress on this host';
  }
}

async function listProjectWorkspaceGroups(
  projects: Array<Pick<Project, 'id' | 'name'>>,
  options: { measure?: boolean } = {}
): Promise<MachineProjectWorkspaces[]> {
  const measure = options.measure ?? true;
  const client = await getDesktopWireClient();
  const groups = await Promise.all(
    projects.map(async (project) => {
      const listed = await client.projectWorkspaces.listProjectWorkspaces({
        projectId: project.id,
      });
      if (!measure) return { project, workspaces: listed.rows };

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
