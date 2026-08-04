import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ok, type Result } from '@emdash/shared';
import type { HostAbsolutePath } from '@primitives/path/api';
import {
  computeBaseRef,
  gitErr,
  type CloneRepositoryError,
  type CloneRepositoryInitialize,
  type EnsureRepositoryError,
  type EnsureRepositoryOptions,
  type GitPathInspection,
  type GitRepositoryInfo,
} from '@runtimes/git/api';
import { toHostAbsolutePath, toNativeAbsolutePath } from '@runtimes/git/node/allocation/paths';
import { gitFailure } from '@runtimes/git/node/exec/errors';
import type { GitOperationContext } from '@runtimes/git/node/exec/operation-context';
import {
  execGitWithProgress,
  throwIfGitOpAborted,
} from '@runtimes/git/node/exec/transfer-progress';
import { ExecError, type BoundExec } from '@services/exec/api';
import { repositoryFailures } from './errors';

/** Executes Git operations that happen before a canonical repository mount exists. */
export class GitRepositoryProvisioner {
  constructor(private readonly exec: BoundExec) {}

  inspectPath(pathToInspect: HostAbsolutePath): Promise<GitPathInspection> {
    try {
      return this.inspectResolvedPath(toNativeAbsolutePath(pathToInspect), pathToInspect);
    } catch (error) {
      return Promise.resolve({
        kind: 'inspect-failed',
        path: pathToInspect,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async ensureRepository(
    pathToInspect: HostAbsolutePath,
    options: EnsureRepositoryOptions = {}
  ): Promise<Result<GitRepositoryInfo, EnsureRepositoryError>> {
    const inspected = await this.inspectPath(pathToInspect);
    if (inspected.kind === 'repository') return ok(inspected);
    if (inspected.kind === 'inspect-failed') {
      return gitErr.inspectFailed(inspected.path, inspected.message);
    }
    if (!options.initIfMissing) return gitErr.notRepository(inspected.path);

    let nativePath: string;
    try {
      nativePath = toNativeAbsolutePath(pathToInspect);
      await this.exec.exec(['-C', nativePath, 'init']);
    } catch (error) {
      const message =
        error instanceof ExecError
          ? gitFailure(error).message
          : error instanceof Error
            ? error.message
            : String(error);
      return gitErr.initFailed(pathToInspect, message);
    }

    const initialized = await this.inspectResolvedPath(nativePath, pathToInspect);
    if (initialized.kind === 'repository') return ok(initialized);
    if (initialized.kind === 'inspect-failed') {
      return gitErr.inspectFailed(initialized.path, initialized.message);
    }
    return gitErr.initFailed(pathToInspect, 'Failed to initialize git repository');
  }

  async cloneRepository(
    repositoryUrl: string,
    targetPath: HostAbsolutePath,
    context: GitOperationContext = {},
    options: { initialize?: CloneRepositoryInitialize } = {}
  ): Promise<Result<GitRepositoryInfo, CloneRepositoryError>> {
    let nativeTargetPath: string;
    try {
      nativeTargetPath = toNativeAbsolutePath(targetPath);
      await execGitWithProgress(
        this.exec.withCwd(path.dirname(nativeTargetPath)),
        ['clone', '--progress', repositoryUrl, nativeTargetPath],
        context
      );
    } catch (error) {
      if (context.signal?.aborted) throw error;
      if (!(error instanceof ExecError)) {
        return gitErr.commandFailed(error instanceof Error ? error.message : String(error));
      }
      return repositoryFailures.clone(error, targetPath);
    }

    if (options.initialize) {
      const initialized = await this.initializeClonedRepository(
        nativeTargetPath,
        options.initialize,
        context
      );
      if (!initialized.success) return initialized;
    }

    const inspected = await this.inspectResolvedPath(nativeTargetPath, targetPath);
    if (inspected.kind === 'repository') return ok(inspected);
    if (inspected.kind === 'inspect-failed') {
      return gitErr.commandFailed(inspected.message);
    }
    return gitErr.commandFailed(`Cloned path is not a git repository: ${nativeTargetPath}`);
  }

  /**
   * Seeds a freshly created (empty) repository with an initial README commit and
   * pushes it upstream so the remote's default branch exists.
   */
  private async initializeClonedRepository(
    nativeTargetPath: string,
    initialize: CloneRepositoryInitialize,
    context: GitOperationContext
  ): Promise<Result<void, CloneRepositoryError>> {
    const exec = (args: string[]) =>
      this.exec.exec(['-C', nativeTargetPath, ...args], { signal: context.signal });
    try {
      context.onProgress?.({ phase: 'initialize', detail: 'Creating initial commit' });
      await writeFile(
        path.join(nativeTargetPath, 'README.md'),
        initialReadmeContent(initialize),
        'utf8'
      );
      throwIfGitOpAborted(context.signal);
      await exec(['add', '--', 'README.md']);
      await exec(['commit', '-m', 'Initial commit']);
      throwIfGitOpAborted(context.signal);
      context.onProgress?.({ phase: 'initialize', detail: 'Pushing initial commit' });
      await exec(['push', '-u', 'origin', 'HEAD']);
      return ok(undefined);
    } catch (error) {
      if (context.signal?.aborted) throw error;
      const message =
        error instanceof ExecError
          ? gitFailure(error).message
          : error instanceof Error
            ? error.message
            : String(error);
      return gitErr.commandFailed(`Failed to initialize cloned repository: ${message}`);
    }
  }

  private async inspectResolvedPath(
    nativePath: string,
    requestedPath: HostAbsolutePath
  ): Promise<GitPathInspection> {
    const exec = (args: string[]) => this.exec.exec(['-C', nativePath, ...args]);
    try {
      const { stdout: insideWorkTree } = await exec(['rev-parse', '--is-inside-work-tree']);
      if (insideWorkTree.trim() !== 'true') {
        return { kind: 'not-repository', path: requestedPath };
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
      const rootPath = toHostAbsolutePath(rootOutput.trim() || nativePath);

      return {
        kind: 'repository',
        rootPath,
        baseRef: computeBaseRef(undefined, remoteName, branch),
      };
    } catch (error) {
      if (error instanceof ExecError && repositoryFailures.isNotRepository(error)) {
        return { kind: 'not-repository', path: requestedPath };
      }
      return {
        kind: 'inspect-failed',
        path: requestedPath,
        message:
          error instanceof ExecError
            ? gitFailure(error).message
            : error instanceof Error
              ? error.message
              : String(error),
      };
    }
  }
}

function initialReadmeContent(initialize: CloneRepositoryInitialize): string {
  return initialize.description
    ? `# ${initialize.name}\n\n${initialize.description}\n`
    : `# ${initialize.name}\n`;
}
