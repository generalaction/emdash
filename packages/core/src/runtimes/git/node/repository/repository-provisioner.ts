import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ok, type Result } from '@emdash/shared';
import { KeyedMutex } from '@emdash/shared/concurrency';
import {
  isGitDiscoveryMiss,
  parseGitDubiousOwnership,
  safeDirectoryValueProblem,
  type GitDubiousOwnership,
} from '#primitives/git/api';
import type { HostAbsolutePath } from '#primitives/path/api';
import {
  computeBaseRef,
  gitErr,
  type CloneRepositoryError,
  type EnsureRepositoryError,
  type EnsureRepositoryOptions,
  type GitPathInspection,
  type GitRepositoryInfo,
  type InspectPathError,
  type TrustRepositoryError,
  type TrustRepositoryResult,
} from '#runtimes/git/api';
import { toHostAbsolutePath, toNativeAbsolutePath } from '#runtimes/git/node/allocation/paths';
import { gitFailure } from '#runtimes/git/node/exec/errors';
import type { GitOperationContext } from '#runtimes/git/node/exec/operation-context';
import { execGitWithProgress } from '#runtimes/git/node/exec/transfer-progress';
import { ExecError, type BoundExec } from '#services/exec/api';
import { repositoryFailures } from './errors';

/** Executes Git operations that happen before a canonical repository mount exists. */
export class GitRepositoryProvisioner {
  // Serializes trust requests so concurrent ones never add the same entry twice.
  private readonly globalConfig = new KeyedMutex();

  constructor(private readonly exec: BoundExec) {}

  inspectPath(
    pathToInspect: HostAbsolutePath
  ): Promise<Result<GitPathInspection, InspectPathError>> {
    try {
      return this.inspectResolvedPath(toNativeAbsolutePath(pathToInspect), pathToInspect);
    } catch (error) {
      return Promise.resolve(
        gitErr.inspectFailed(pathToInspect, error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * Adds the `safe.directory` entry Git suggests for a repository it refuses for its ownership,
   * once the user confirmed exactly that value. Git is asked again rather than trusting the
   * caller, at most one exact path is written to the global config of the user running Git, and
   * an entry that does not make Git accept the repository is removed again.
   */
  async trustRepository(
    pathToTrust: HostAbsolutePath,
    safeDirectory: string
  ): Promise<Result<TrustRepositoryResult, TrustRepositoryError>> {
    const problem = safeDirectoryValueProblem(safeDirectory);
    if (problem) return gitErr.trustFailed(pathToTrust, 'invalid-value', problem);
    let nativePath: string;
    try {
      nativePath = toNativeAbsolutePath(pathToTrust);
    } catch (error) {
      return gitErr.trustFailed(
        pathToTrust,
        'invalid-value',
        error instanceof Error ? error.message : String(error)
      );
    }

    return this.globalConfig.runExclusive('safe.directory', async () => {
      const refused = await this.ownershipRefusal(nativePath);
      if (!refused) return ok({ added: false });
      if (refused.safeDirectory !== safeDirectory) {
        return gitErr.trustFailed(
          pathToTrust,
          'repository-changed',
          `Git now asks to trust ${refused.safeDirectory} instead. Check the directory and try again.`
        );
      }

      try {
        if ((await this.globalSafeDirectories()).includes(safeDirectory)) {
          return gitErr.trustFailed(
            pathToTrust,
            'still-refused',
            `Your global Git config already trusts ${safeDirectory}, but Git still refuses this repository.`
          );
        }
        // Config commands run from the executor's cwd, never inside the refused repository.
        await this.exec.exec(['config', '--global', '--add', 'safe.directory', safeDirectory]);
      } catch (error) {
        return gitErr.trustFailed(pathToTrust, 'config-failed', gitFailure(error).message);
      }
      if (!(await this.ownershipRefusal(nativePath))) return ok({ added: true });

      let removed = true;
      try {
        await this.exec.exec([
          'config',
          '--global',
          '--fixed-value',
          '--unset',
          'safe.directory',
          safeDirectory,
        ]);
      } catch (error) {
        if (!(error instanceof ExecError)) throw error;
        removed = false;
      }
      return gitErr.trustFailed(
        pathToTrust,
        'still-refused',
        removed
          ? `Git still refuses this repository with safe.directory ${safeDirectory}, so the entry was removed again.`
          : `Git still refuses this repository with safe.directory ${safeDirectory}, and the entry could not be removed from your global Git config.`
      );
    });
  }

  async ensureRepository(
    pathToInspect: HostAbsolutePath,
    options: EnsureRepositoryOptions = {}
  ): Promise<Result<GitRepositoryInfo, EnsureRepositoryError>> {
    const inspected = await this.inspectPath(pathToInspect);
    if (!inspected.success) return inspected;
    if (inspected.data.kind === 'repository') return ok(inspected.data);
    if (!options.initIfMissing) return gitErr.notRepository(inspected.data.path);

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
    if (!initialized.success) return initialized;
    if (initialized.data.kind === 'repository') return ok(initialized.data);
    return gitErr.initFailed(pathToInspect, 'Failed to initialize git repository');
  }

  async cloneRepository(
    repositoryUrl: string,
    targetPath: HostAbsolutePath,
    context: GitOperationContext = {}
  ): Promise<Result<GitRepositoryInfo, CloneRepositoryError>> {
    let nativeTargetPath: string;
    try {
      nativeTargetPath = toNativeAbsolutePath(targetPath);
      await mkdir(path.dirname(nativeTargetPath), { recursive: true });
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

    const inspected = await this.inspectResolvedPath(nativeTargetPath, targetPath);
    if (!inspected.success) return gitErr.commandFailed(inspected.error.message);
    if (inspected.data.kind === 'repository') return ok(inspected.data);
    return gitErr.commandFailed(`Cloned path is not a git repository: ${nativeTargetPath}`);
  }

  private async inspectResolvedPath(
    nativePath: string,
    requestedPath: HostAbsolutePath
  ): Promise<Result<GitPathInspection, InspectPathError>> {
    const exec = (args: string[]) => this.exec.exec(['-C', nativePath, ...args]);
    try {
      let insideWorkTree: string;
      try {
        ({ stdout: insideWorkTree } = await exec(['rev-parse', '--is-inside-work-tree']));
      } catch (error) {
        if (error instanceof ExecError && isGitDiscoveryMiss(error)) {
          return ok({ kind: 'not-repository', path: requestedPath });
        }
        throw error;
      }
      if (insideWorkTree.trim() === 'false') {
        return ok({ kind: 'not-repository', path: requestedPath });
      }
      if (insideWorkTree.trim() !== 'true') {
        return gitErr.inspectFailed(
          requestedPath,
          `Unexpected git rev-parse output: ${insideWorkTree}`
        );
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

      return ok({
        kind: 'repository',
        rootPath,
        baseRef: computeBaseRef(undefined, remoteName, branch),
      });
    } catch (error) {
      if (error instanceof ExecError) {
        return gitErr.inspectFailed(
          requestedPath,
          gitFailure(error).message,
          parseGitDubiousOwnership(error)
        );
      }
      return gitErr.inspectFailed(
        requestedPath,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /** Git's ownership refusal for a directory, or null when Git does not refuse it. */
  private async ownershipRefusal(nativePath: string): Promise<GitDubiousOwnership | null> {
    try {
      await this.exec.exec(['-C', nativePath, 'rev-parse', '--is-inside-work-tree']);
      return null;
    } catch (error) {
      if (!(error instanceof ExecError)) throw error;
      return parseGitDubiousOwnership(error);
    }
  }

  private async globalSafeDirectories(): Promise<string[]> {
    try {
      const { stdout } = await this.exec.exec([
        'config',
        '--global',
        '--null',
        '--get-all',
        'safe.directory',
      ]);
      // --null terminates every value with NUL, so the last element is always empty.
      return stdout.split('\0').slice(0, -1);
    } catch (error) {
      // Exit 1: the key is not set (or the global config does not exist yet).
      if (error instanceof ExecError && error.exitCode === 1) return [];
      throw error;
    }
  }
}
