import path from 'node:path';
import type { BoundExec } from '@emdash/core/exec';
import {
  classifyCloneRepositoryError,
  computeBaseRef,
  gitErrorMessage,
  isNotRepositoryInspectionError,
  type CloneRepositoryError,
  type EnsureRepositoryError,
  type EnsureRepositoryOptions,
  type GitPathInspection,
  type GitRepositoryInfo,
} from '@emdash/core/git';
import { realpathOrResolve } from '@emdash/core/watch';
import { err, ok, type Result } from '@emdash/shared';
import type { GitOperationContext } from '../exec/operation-context';
import { execGitWithProgress } from '../exec/transfer-progress';

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
      return err({ type: 'inspect-failed', path: inspected.path, message: inspected.message });
    }
    if (!options.initIfMissing) return err({ type: 'not-repository', path: inspected.path });

    try {
      await this.exec.exec(['-C', resolvedPath, 'init']);
    } catch (error) {
      return err({ type: 'init-failed', path: resolvedPath, message: gitErrorMessage(error) });
    }

    const initialized = await this.inspectResolvedPath(resolvedPath);
    if (initialized.kind === 'repository') return ok(initialized);
    if (initialized.kind === 'inspect-failed') {
      return err({
        type: 'inspect-failed',
        path: initialized.path,
        message: initialized.message,
      });
    }
    return err({
      type: 'init-failed',
      path: resolvedPath,
      message: 'Failed to initialize git repository',
    });
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
      return err(classifyCloneRepositoryError(error, resolvedTargetPath));
    }

    const inspected = await this.inspectResolvedPath(resolvedTargetPath);
    if (inspected.kind === 'repository') return ok(inspected);
    if (inspected.kind === 'inspect-failed') {
      return err({ type: 'git_error', message: inspected.message });
    }
    return err({
      type: 'git_error',
      message: `Cloned path is not a git repository: ${resolvedTargetPath}`,
    });
  }

  private async inspectResolvedPath(resolvedPath: string): Promise<GitPathInspection> {
    const exec = (args: string[]) => this.exec.exec(['-C', resolvedPath, ...args]);
    try {
      const { stdout } = await exec(['rev-parse', '--is-inside-work-tree']);
      if (stdout.trim() !== 'true') return { kind: 'not-repository', path: resolvedPath };
    } catch (error) {
      if (isNotRepositoryInspectionError(error)) {
        return { kind: 'not-repository', path: resolvedPath };
      }
      return { kind: 'inspect-failed', path: resolvedPath, message: gitErrorMessage(error) };
    }

    let remoteName: string | undefined;
    try {
      const { stdout } = await exec(['remote']);
      const remotes = stdout.trim().split('\n').filter(Boolean);
      remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
    } catch {}

    let branch: string | undefined;
    try {
      const { stdout } = await exec(['branch', '--show-current']);
      branch = stdout.trim() || undefined;
    } catch {}

    if (!branch && remoteName) {
      try {
        const { stdout } = await exec(['remote', 'show', remoteName]);
        branch = /HEAD branch:\s*(\S+)/.exec(stdout)?.[1] || undefined;
      } catch {}
    }

    let rootPath = resolvedPath;
    try {
      const { stdout } = await exec(['rev-parse', '--show-toplevel']);
      if (stdout.trim()) rootPath = realpathOrResolve(stdout.trim());
    } catch {}

    return {
      kind: 'repository',
      rootPath,
      baseRef: computeBaseRef(undefined, remoteName, branch),
    };
  }
}
