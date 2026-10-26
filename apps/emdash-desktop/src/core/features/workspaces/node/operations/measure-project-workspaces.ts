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

/**
 * Measures the requested rows on their host. Host calls have no deadline — a large
 * tree legitimately takes a while — and are bounded by `signal` instead: cancelling it
 * (the view closed) stops the walks still running and skips the rows not yet started.
 */
export async function measureProjectWorkspaces(
  dependencies: ListProjectWorkspacesDependencies,
  input: MeasureProjectWorkspacesInput,
  signal?: AbortSignal
): Promise<MeasureProjectWorkspacesResult> {
  if (input.paths.length === 0) {
    return { scannedAt: new Date().toISOString(), projectId: input.projectId, results: [] };
  }

  const project = await getProjectWorkspaceProject(dependencies.db, input.projectId);
  const listed = await listProjectWorkspaces(dependencies, input.projectId);
  signal?.throwIfAborted();
  const rowsByPath = new Map(
    listed.rows.map((row) => [workspacePathIdentityKey(row.path), row] as const)
  );
  const measuredRows = input.paths.flatMap((targetPath) => {
    const row = rowsByPath.get(workspacePathIdentityKey(targetPath));
    return row?.pathState === 'measured' && row.workspaceId ? [row] : [];
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
    return await measureRow(
      dependencies,
      project,
      row,
      nestedWorkspaceIds(row, measuredRows),
      signal
    );
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
  excludeWorkspaceIds: string[],
  signal: AbortSignal | undefined
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

/**
 * The other measured rows inside `row`, so the host skips them and each byte counts
 * once, in its most specific row. A lenient prefix check over identity keys; the host
 * re-checks containment against its own records.
 */
function nestedWorkspaceIds(row: ProjectWorkspaceRow, measuredRows: ProjectWorkspaceRow[]) {
  const parentKey = workspacePathIdentityKey(row.path);
  const prefix = parentKey.endsWith('/') ? parentKey : `${parentKey}/`;
  return measuredRows.flatMap((other) =>
    other !== row && other.workspaceId && workspacePathIdentityKey(other.path).startsWith(prefix)
      ? [other.workspaceId]
      : []
  );
}

function measureUsageErrorMessage(error: MeasureUsageError): string {
  return error.type === 'workspace-not-found'
    ? 'Workspace is not registered on the host.'
    : error.message;
}
