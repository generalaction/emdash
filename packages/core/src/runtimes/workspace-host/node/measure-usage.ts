import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { formatAbsolute, type HostAbsolutePath } from '#primitives/path/api';
import { defaultGitExecFactory, type GitExecFactory } from '#services/exec/node/git-exec';
import { measureAbsolutePathUsage } from '#services/fs-usage/node';
import type { WorkspaceHostError, WorkspaceHostUsage } from '../api';

export type MeasureWorkspaceUsageOptions = {
  workspacePath: HostAbsolutePath;
  signal?: AbortSignal;
  createGitExec?: GitExecFactory;
};

/**
 * Measures a workspace's disk footprint. Total bytes are exclusive disk usage;
 * artifact bytes cover git-ignored build output (`git clean -ndX` roots), so
 * callers can show "reclaimable" space separately.
 */
export async function measureWorkspaceUsage(
  options: MeasureWorkspaceUsageOptions
): Promise<Result<WorkspaceHostUsage, WorkspaceHostError>> {
  const workspacePath = formatNativePath(options.workspacePath);
  const artifactRoots = await listIgnoredArtifactRoots(workspacePath, options);
  if (!artifactRoots.success) return artifactRoots;
  try {
    const measured = await measureAbsolutePathUsage(workspacePath, '', {
      artifactRoots: artifactRoots.data,
    });
    return ok({
      path: options.workspacePath,
      totalBytes: measured.exclusiveDiskBytes,
      artifactBytes: measured.artifactBytes,
      errors: measured.errors,
    });
  } catch (error) {
    return err({
      type: 'filesystem-error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function listIgnoredArtifactRoots(
  workspacePath: string,
  options: Pick<MeasureWorkspaceUsageOptions, 'signal' | 'createGitExec'>
): Promise<Result<string[], WorkspaceHostError>> {
  const createGitExec = options.createGitExec ?? defaultGitExecFactory;
  let stdout: string;
  try {
    const result = await createGitExec(workspacePath).exec(
      ['-c', 'core.quotePath=false', 'clean', '-ndX', '--'],
      options.signal ? { signal: options.signal } : {}
    );
    stdout = result.stdout;
  } catch (error) {
    return err({
      type: 'git-command-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const root = path.resolve(workspacePath);
  const roots: string[] = [];
  for (const line of stdout.split(/\r?\n/u)) {
    const relativePath = parseGitCleanDryRunLine(line);
    if (!relativePath) continue;
    if (!isContainedBy(root, path.resolve(root, relativePath))) {
      return err({
        type: 'operation-rejected',
        code: 'unsafe-artifact-path',
        message: `Ignored artifact escapes workspace: ${relativePath}`,
      });
    }
    roots.push(relativePath);
  }
  return ok(roots);
}

function parseGitCleanDryRunLine(line: string): string | undefined {
  const prefix = 'Would remove ';
  if (!line.startsWith(prefix)) return undefined;
  const normalized = line.slice(prefix.length).trim().replace(/\/$/u, '').split('\\').join('/');
  if (!normalized || normalized === '.' || normalized === '..') return undefined;
  return normalized;
}

function isContainedBy(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function formatNativePath(absolutePath: HostAbsolutePath): string {
  return formatAbsolute(absolutePath, {
    separator: absolutePath.root.kind === 'posix' ? '/' : '\\',
  });
}
