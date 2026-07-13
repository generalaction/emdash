import { access } from 'node:fs/promises';
import { err, ok, type Result } from '@emdash/shared';
import type { HostFileRef } from '@primitives/path/api';
import type {
  ConvertWorkspaceInput,
  ProvisionWorkspaceInput,
  WorkspaceError,
  WorkspaceTopology,
} from '@runtimes/workspace/api';
import { runGit } from '@services/workspace-lifecycle/api';
import { nativePathFromWorkspace, resolveNativePath, workspaceFromNativePath } from './paths';

export type WorkspaceProvisioner = {
  inspect(
    workspace: HostFileRef,
    options?: { signal?: AbortSignal }
  ): Promise<Result<WorkspaceTopology, WorkspaceError>>;
  provision(
    input: ProvisionWorkspaceInput,
    options?: { signal?: AbortSignal }
  ): Promise<Result<WorkspaceTopology, WorkspaceError>>;
  convert(
    input: ConvertWorkspaceInput,
    options?: { signal?: AbortSignal }
  ): Promise<Result<WorkspaceTopology, WorkspaceError>>;
  remove(
    workspace: HostFileRef,
    options?: { signal?: AbortSignal }
  ): Promise<Result<void, WorkspaceError>>;
};

export class NodeWorkspaceProvisioner implements WorkspaceProvisioner {
  async inspect(
    workspace: HostFileRef,
    options: { signal?: AbortSignal } = {}
  ): Promise<Result<WorkspaceTopology, WorkspaceError>> {
    const workspacePath = nativePathFromWorkspace(workspace);
    if (!(await exists(workspacePath))) return ok({ kind: 'missing' });

    const toplevel = await runGit(['rev-parse', '--show-toplevel'], {
      cwd: workspacePath,
      signal: options.signal,
    });
    if (!toplevel.success) return ok({ kind: 'directory' });

    const gitDir = await runGit(['rev-parse', '--git-dir'], {
      cwd: workspacePath,
      signal: options.signal,
    });
    const commonDir = await runGit(['rev-parse', '--git-common-dir'], {
      cwd: workspacePath,
      signal: options.signal,
    });
    const branch = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspacePath,
      signal: options.signal,
    });

    const repositoryRoot = workspaceFromNativePath(toplevel.data.stdout.trim(), workspace.host);
    const gitDirRef = gitDir.success
      ? workspaceFromNativePath(
          resolveNativePath(workspacePath, gitDir.data.stdout.trim()),
          workspace.host
        )
      : undefined;
    const commonDirRef = commonDir.success
      ? workspaceFromNativePath(
          resolveNativePath(workspacePath, commonDir.data.stdout.trim()),
          workspace.host
        )
      : undefined;
    const branchName = branch.success ? normalizeBranch(branch.data.stdout.trim()) : undefined;

    if (
      gitDirRef &&
      commonDirRef &&
      nativePathFromWorkspace(gitDirRef) !== nativePathFromWorkspace(commonDirRef)
    ) {
      return ok({
        kind: 'worktree',
        repositoryRoot,
        gitDir: gitDirRef,
        commonDir: commonDirRef,
        branchName,
      });
    }

    return ok({
      kind: 'repository',
      repositoryRoot,
      gitDir: gitDirRef,
      branchName,
    });
  }

  async provision(
    input: ProvisionWorkspaceInput,
    options: { signal?: AbortSignal } = {}
  ): Promise<Result<WorkspaceTopology, WorkspaceError>> {
    return await this.inspect(input.workspace, options);
  }

  async convert(
    input: ConvertWorkspaceInput,
    options: { signal?: AbortSignal } = {}
  ): Promise<Result<WorkspaceTopology, WorkspaceError>> {
    const workspacePath = nativePathFromWorkspace(input.workspace);
    if (input.to.kind === 'repository' && input.to.operation === 'init') {
      const result = await runGit(['init'], { cwd: workspacePath, signal: options.signal });
      if (!result.success) {
        return err({
          type: result.error.type,
          message: result.error.message,
        });
      }
      return await this.inspect(input.workspace, options);
    }

    return err({
      type: 'conversion-unsupported',
      message: `Workspace conversion to ${input.to.kind} is not supported by this implementation yet`,
      resolutions: ['use explicit lifecycle provision plan'],
    });
  }

  async remove(): Promise<Result<void, WorkspaceError>> {
    return err({
      type: 'remove-unsupported',
      message: 'Workspace removal is handled by lifecycle teardown plans in this implementation',
      resolutions: ['provide a lifecycle teardown plan'],
    });
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeBranch(branch: string): string | undefined {
  if (!branch || branch === 'HEAD') return undefined;
  return branch;
}
