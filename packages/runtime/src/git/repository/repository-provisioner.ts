import path from 'node:path';
import type { BoundExec } from '@emdash/core/exec';
import {
  computeBaseRef,
  gitErr,
  type CloneRepositoryError,
  type EnsureRepositoryError,
  type EnsureRepositoryOptions,
  type GitPathInspection,
  type GitRepositoryInfo,
} from '@emdash/core/git';
import { ok, type Result } from '@emdash/shared';
import { realpathOrResolve } from '../allocation/paths';
import { gitFailure } from '../exec/errors';
import type { GitOperationContext } from '../exec/operation-context';
import { execGitWithProgress } from '../exec/transfer-progress';
import { repositoryFailures } from './errors';

/** Executes Git operations that happen before a canonical repository mount exists. */
export class GitRepositoryProvisioner {
  constructor(private readonly exec: BoundExec) {}

  inspectPath(pathToInspect: string): Promise<GitPathInspection> {
    return this.inspectResolvedPath(path.resolve(pathToInspect));
  }

  async ensureRepository(
    pathToInspect: string,
    options: EnsureRepositoryOptions = {}
  ): Promise<Result<GitRepositoryInfo, EnsureRepositoryError>> {
    const resolvedPath = path.resolve(pathToInspect);
    const inspected = await this.inspectResolvedPath(resolvedPath);
    if (inspected.kind === 'repository') return ok(inspected);
    if (inspected.kind === 'inspect-failed') {
      return gitErr.inspectFailed(inspected.path, inspected.message);
    }
    if (!options.initIfMissing) return gitErr.notRepository(inspected.path);

    try {
      await this.exec.exec(['-C', resolvedPath, 'init']);
    } catch (error) {
      return gitErr.initFailed(resolvedPath, gitFailure(error).message);
    }

    const initialized = await this.inspectResolvedPath(resolvedPath);
    if (initialized.kind === 'repository') return ok(initialized);
    if (initialized.kind === 'inspect-failed') {
      return gitErr.inspectFailed(initialized.path, initialized.message);
    }
    return gitErr.initFailed(resolvedPath, 'Failed to initialize git repository');
  }

  async cloneRepository(
    repositoryUrl: string,
    targetPath: string,
    context: GitOperationContext = {}
  ): Promise<Result<GitRepositoryInfo, CloneRepositoryError>> {
    const resolvedTargetPath = path.resolve(targetPath);
    try {
      await execGitWithProgress(
        this.exec.withCwd(path.dirname(resolvedTargetPath)),
        ['clone', '--progress', repositoryUrl, resolvedTargetPath],
        context
      );
    } catch (error) {
      if (context.signal?.aborted) throw error;
      return repositoryFailures.clone(error, resolvedTargetPath);
    }

    const inspected = await this.inspectResolvedPath(resolvedTargetPath);
    if (inspected.kind === 'repository') return ok(inspected);
    if (inspected.kind === 'inspect-failed') {
      return gitErr.commandFailed(inspected.message);
    }
    return gitErr.commandFailed(`Cloned path is not a git repository: ${resolvedTargetPath}`);
  }

  private async inspectResolvedPath(resolvedPath: string): Promise<GitPathInspection> {
    const exec = (args: string[]) => this.exec.exec(['-C', resolvedPath, ...args]);
    try {
      const { stdout: insideWorkTree } = await exec(['rev-parse', '--is-inside-work-tree']);
      if (insideWorkTree.trim() !== 'true') {
        return { kind: 'not-repository', path: resolvedPath };
      }

      const { stdout: remoteOutput } = await exec(['remote']);
      const remotes = remoteOutput.trim().split('\n').filter(Boolean);
      const remoteName = remotes.includes('origin') ? 'origin' : remotes[0];

      const { stdout: branchOutput } = await exec(['branch', '--show-current']);
      let branch = branchOutput.trim() || undefined;

      if (!branch && remoteName) {
        try {
          const { stdout: remoteHead } = await exec([
            'symbolic-ref',
            '--short',
            `refs/remotes/${remoteName}/HEAD`,
          ]);
          branch = remoteHead.trim().replace(`${remoteName}/`, '') || undefined;
        } catch (error) {
          if (!repositoryFailures.isMissingSymbolicRef(error)) throw error;
        }
      }

      const { stdout: rootOutput } = await exec(['rev-parse', '--show-toplevel']);
      const rootPath = rootOutput.trim() ? realpathOrResolve(rootOutput.trim()) : resolvedPath;

      return {
        kind: 'repository',
        rootPath,
        baseRef: computeBaseRef(undefined, remoteName, branch),
      };
    } catch (error) {
      if (repositoryFailures.isNotRepository(error)) {
        return { kind: 'not-repository', path: resolvedPath };
      }
      return { kind: 'inspect-failed', path: resolvedPath, message: gitFailure(error).message };
    }
  }
}
