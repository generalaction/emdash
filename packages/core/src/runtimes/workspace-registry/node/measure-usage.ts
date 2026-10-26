import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { measureAbsolutePathUsage } from '#services/fs-usage/node';
import type { WorkspaceUsage } from '../api/schemas';
import {
  listWorkspaceArtifacts,
  type WorkspaceArtifactsError,
  type WorkspaceArtifactsOptions,
} from './workspace-artifacts';

/** Everything but the record-resolution variant, which the runtime handles itself. */
export type MeasureWorkspaceUsageError = WorkspaceArtifactsError;

export type MeasureWorkspaceUsageOptions = WorkspaceArtifactsOptions & {
  /** Absolute paths of nested workspaces measured on their own; their bytes are skipped. */
  excludePaths?: string[];
};

/**
 * Measures a workspace's disk footprint. Total bytes are exclusive disk usage;
 * artifact bytes cover exactly what `cleanArtifacts` would remove (see
 * {@link listWorkspaceArtifacts}), so callers can show "reclaimable" space
 * separately. Cancellation rejects with the signal's reason rather than resolving
 * to a failure.
 */
export async function measureWorkspaceUsage(
  options: MeasureWorkspaceUsageOptions
): Promise<Result<WorkspaceUsage, MeasureWorkspaceUsageError>> {
  const artifactRoots = await listWorkspaceArtifacts(options);
  if (!artifactRoots.success) return artifactRoots;
  try {
    const measured = await measureAbsolutePathUsage(options.workspacePath, '', {
      artifactRoots: artifactRoots.data,
      excludePaths: options.excludePaths,
      signal: options.signal,
    });
    return ok({
      totalBytes: measured.exclusiveDiskBytes,
      artifactBytes: measured.artifactBytes,
      errors: measured.errors,
    });
  } catch (error) {
    options.signal?.throwIfAborted();
    return err({
      type: 'filesystem-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The candidates strictly inside `workspacePath`: nested workspaces its walk can skip. */
export function nestedWorkspacePaths(workspacePath: string, candidates: string[]): string[] {
  const root = path.resolve(workspacePath);
  return candidates.filter((candidate) => isContainedBy(root, path.resolve(candidate)));
}

function isContainedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
