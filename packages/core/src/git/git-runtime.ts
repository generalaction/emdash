import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { BoundExec } from '../exec';
import { KeyedMutex } from '../lib';
import { WatchService, realpathOrResolve, type IWatchService } from '../watch';
import type { EnsureRepositoryOptions } from './api/commands';
import type { CloneRepositoryError, EnsureRepositoryError } from './api/errors';
import type { GitPathInspection, GitRepositoryInfo } from './api/queries';
import { computeBaseRef } from './base-ref';
import {
  classifyCloneRepositoryError,
  gitErrorMessage,
  isNotRepositoryInspectionError,
} from './errors';
import { createGitExec } from './git-env';
import { GitSessionManager } from './session/session-manager';
import type { GitOnError } from './session/types';
import { execGitWithProgress, type GitOpContext } from './transfer-progress';

export type GitRuntimeOptions = {
  watcher?: IWatchService;
  executable?: string;
  env?: NodeJS.ProcessEnv;
  exec?: BoundExec;
  onError?: GitOnError;
};

export class GitRuntime {
  readonly sessions: GitSessionManager;

  private readonly exec: BoundExec;
  private readonly watcher: IWatchService;
  private readonly ownsWatcher: boolean;

  constructor(options: GitRuntimeOptions = {}) {
    const onError = options.onError ?? (() => {});
    this.ownsWatcher = !options.watcher;
    this.watcher = options.watcher ?? new WatchService({ onError });
    this.exec =
      options.exec ??
      createGitExec({
        cwd: process.cwd(),
        executable: options.executable,
        env: options.env,
      });
    this.sessions = new GitSessionManager({
      exec: this.exec,
      watcher: this.watcher,
      objectStoreMutex: new KeyedMutex(),
      onError,
    });
  }

  async inspectPath(pathToInspect: string): Promise<GitPathInspection> {
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
    if (!options.initIfMissing) {
      return err({ type: 'not-repository', path: inspected.path });
    }

    try {
      await this.exec.withCwd(resolvedPath).exec(['init']);
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
    context: GitOpContext = {}
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

  async dispose(): Promise<void> {
    await this.sessions.dispose();
    if (this.ownsWatcher) await this.watcher.dispose();
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
      return {
        kind: 'inspect-failed',
        path: resolvedPath,
        message: gitErrorMessage(error),
      };
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
        const match = /HEAD branch:\s*(\S+)/.exec(stdout);
        branch = match?.[1] ?? undefined;
      } catch {}
    }

    let rootPath = resolvedPath;
    try {
      const { stdout } = await exec(['rev-parse', '--show-toplevel']);
      const trimmed = stdout.trim();
      if (trimmed) rootPath = realpathOrResolve(trimmed);
    } catch {}

    return {
      kind: 'repository',
      rootPath,
      baseRef: computeBaseRef(undefined, remoteName, branch),
    };
  }
}
