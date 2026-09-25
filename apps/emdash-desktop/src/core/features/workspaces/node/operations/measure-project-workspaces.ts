import type { MeasureUsageError } from '@emdash/core/runtimes/workspace-registry/api';
import {
  runtimeResolveErrorAsError,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import { workspacePathIdentityKey } from '@core/features/workspaces/api/workspace-path-identity';
import type {
  MeasureProjectWorkspacesInput,
  MeasureProjectWorkspacesResult,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsageResult,
} from '@core/primitives/workspaces/api';
import {
  getProjectWorkspaceProject,
  listProjectWorkspaces,
  mapWithConcurrency,
  projectWorkspaceHost,
  type ListProjectWorkspacesDependencies,
} from './list-project-workspaces';

const MEASURE_CONCURRENCY = 4;

export async function measureProjectWorkspaces(
  dependencies: ListProjectWorkspacesDependencies,
  input: MeasureProjectWorkspacesInput,
  signal?: AbortSignal
): Promise<MeasureProjectWorkspacesResult> {
  signal?.throwIfAborted();
  if (input.paths.length === 0) {
    return { scannedAt: new Date().toISOString(), projectId: input.projectId, results: [] };
  }

  const project = await getProjectWorkspaceProject(dependencies.db, input.projectId);
  signal?.throwIfAborted();
  const listed = await listProjectWorkspaces(dependencies, input.projectId);
  signal?.throwIfAborted();
  const rowsByPath = new Map(
    listed.rows.map((row) => [workspacePathIdentityKey(row.path), row] as const)
  );
  const measuredWorkspaceIds = input.paths.flatMap((targetPath) => {
    const row = rowsByPath.get(workspacePathIdentityKey(targetPath));
    return row?.pathState === 'measured' && row.workspaceId ? [row.workspaceId] : [];
  });
  const results = await mapWithConcurrency(input.paths, MEASURE_CONCURRENCY, async (targetPath) => {
    signal?.throwIfAborted();
    const row = rowsByPath.get(workspacePathIdentityKey(targetPath));
    if (!row) {
      return {
        path: targetPath,
        success: false,
        message: 'Workspace was not found.',
      } satisfies ProjectWorkspaceUsageResult;
    }
    const result = await measureRow(dependencies, project, row, measuredWorkspaceIds, signal);
    signal?.throwIfAborted();
    return result;
  });

  return {
    scannedAt: new Date().toISOString(),
    projectId: input.projectId,
    results,
  };
}

async function measureRow(
  dependencies: { runtimes: Pick<RuntimeBroker, 'client'> },
  project: Awaited<ReturnType<typeof getProjectWorkspaceProject>>,
  row: ProjectWorkspaceRow,
  measuredWorkspaceIds: string[],
  signal?: AbortSignal
): Promise<ProjectWorkspaceUsageResult> {
  if (row.pathState === 'missing') {
    return { path: row.path, success: false, message: 'Workspace path is missing.' };
  }
  if (row.pathState === 'no-path') {
    return { path: row.path, success: false, message: 'Workspace path is not available.' };
  }
  if (row.workspaceId === null) {
    return { path: row.path, success: false, message: 'Workspace is not registered.' };
  }

  try {
    const host = projectWorkspaceHost(project);
    const runtime = await dependencies.runtimes.client(host);
    if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
    const excludeWorkspaceIds = measuredWorkspaceIds.filter((id) => id !== row.workspaceId);
    const usage = await runtime.data.workspaceRegistry.measureUsage(
      {
        workspaceId: row.workspaceId,
        ...(excludeWorkspaceIds.length > 0 ? { excludeWorkspaceIds } : {}),
      },
      { signal }
    );
    if (!usage.success) {
      const message = measureUsageErrorMessage(usage.error);
      return {
        path: row.path,
        success: false,
        message,
        errors: [{ path: row.path, message }],
      };
    }
    return {
      path: row.path,
      success: true,
      usage: {
        totalBytes: usage.data.totalBytes,
        artifactBytes: usage.data.artifactBytes,
        errors: usage.data.errors,
      },
    };
  } catch (error) {
    signal?.throwIfAborted();
    return {
      path: row.path,
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function measureUsageErrorMessage(error: MeasureUsageError): string {
  return error.type === 'workspace-not-found'
    ? 'Workspace is not registered on the host.'
    : error.message;
}
