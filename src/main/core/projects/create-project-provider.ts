import fs from 'node:fs';
import path from 'node:path';
import { GitHubAuthExecutionContext } from '@main/core/execution-context/github-auth-execution-context';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import type { SshConnectionManagerEvent } from '@main/core/ssh/lifecycle/ssh-connection-manager';
import { log } from '@main/lib/logger';
import { safePathSegment } from '@shared/path-name';
import type { LocalProject, SshProject } from '@shared/projects';
import { ProjectProvider, type ProjectProviderTransport } from './project-provider';
import type { ProjectSettingsProvider } from './settings/provider';
import { LocalProjectSettingsProvider } from './settings/providers/local-project-settings-provider';
import { SshProjectSettingsProvider } from './settings/providers/ssh-project-settings-provider';
import { LocalWorktreeHost } from './worktrees/hosts/local-worktree-host';
import { SshWorktreeHost } from './worktrees/hosts/ssh-worktree-host';
import type { WorktreeHost } from './worktrees/hosts/worktree-host';
import { WorktreeService } from './worktrees/worktree-service';

const hasGitHubToken = async (): Promise<boolean> =>
  (await githubConnectionService.getToken()) !== null;

export async function createProvider(project: LocalProject | SshProject): Promise<ProjectProvider> {
  if (project.type === 'ssh') {
    return createSshProvider(project);
  }
  return createLocalProvider(project);
}

async function createLocalProvider(project: LocalProject): Promise<ProjectProvider> {
  const localFs = new LocalFileSystem(project.path);
  const baseCtx = new LocalExecutionContext({ root: project.path });
  const authCtx = new GitHubAuthExecutionContext(baseCtx, () => githubConnectionService.getToken());
  const ctx = baseCtx;
  const repoGit = new GitService(ctx, authCtx, localFs);

  const settings = new LocalProjectSettingsProvider(project.id, project.path, project.baseRef, {
    git: repoGit,
  });
  const worktreeDirectory = await settings.getWorktreeDirectory();
  await fs.promises.mkdir(worktreeDirectory, { recursive: true });
  const worktreeHost = await LocalWorktreeHost.create({
    allowedRoots: [project.path, worktreeDirectory],
  });
  const resolveWorktreePoolPath = async () => {
    const directory = await settings.getWorktreeDirectory();
    await fs.promises.mkdir(directory, { recursive: true });
    await worktreeHost.allowRoot(directory);
    return path.join(directory, safePathSegment(project.name, project.id));
  };

  return buildProvider(
    project.id,
    project.path,
    { kind: 'local', defaultWorkspaceType: { kind: 'local' }, ctx, authCtx },
    localFs,
    repoGit,
    settings,
    worktreeHost,
    resolveWorktreePoolPath,
    () => {}
  );
}

async function createSshProvider(project: SshProject): Promise<ProjectProvider> {
  try {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    const rootFs = new SshFileSystem(proxy, '/');
    const projectFs = new SshFileSystem(proxy, project.path);

    const baseCtx = new SshExecutionContext(proxy, { root: project.path });
    const authCtx = new GitHubAuthExecutionContext(baseCtx, () =>
      githubConnectionService.getToken()
    );
    const ctx = baseCtx;
    const repoGit = new GitService(ctx, authCtx, projectFs);

    const settings = new SshProjectSettingsProvider(
      project.id,
      projectFs,
      project.baseRef,
      rootFs,
      project.path,
      baseCtx,
      {
        git: repoGit,
      }
    );
    const worktreeDirectory = await settings.getWorktreeDirectory();
    const worktreePoolPath = path.posix.join(worktreeDirectory, project.name);
    const worktreeHost = new SshWorktreeHost(rootFs);
    await worktreeHost.mkdirAbsolute(worktreePoolPath, { recursive: true });
    const resolveWorktreePoolPath = async () =>
      path.posix.join(await settings.getWorktreeDirectory(), project.name);

    const dispose = () => sshConnectionManager.off('connection-event', handler);

    const provider = buildProvider(
      project.id,
      project.path,
      {
        kind: 'ssh',
        defaultWorkspaceType: { kind: 'ssh', proxy, connectionId: project.connectionId },
        ctx,
        authCtx,
      },
      projectFs,
      repoGit,
      settings,
      worktreeHost,
      resolveWorktreePoolPath,
      dispose
    );

    // Wire reconnect handler after provider is built so gitFetchService is available.
    const handler = (evt: SshConnectionManagerEvent) => {
      if (evt.type === 'reconnected' && evt.connectionId === project.connectionId) {
        void provider.gitFetchService.fetch();
      }
    };
    sshConnectionManager.on('connection-event', handler);

    return provider;
  } catch (error) {
    log.warn('createSshProvider: SSH connection failed', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
    sshConnectionManager.reportChannelError(project.connectionId, error);
    throw error;
  }
}

function buildProvider(
  projectId: string,
  repoPath: string,
  transportMeta: Pick<
    ProjectProviderTransport,
    'kind' | 'defaultWorkspaceType' | 'ctx' | 'authCtx'
  >,
  projectFs: FileSystemProvider,
  repoGit: GitService,
  settings: ProjectSettingsProvider,
  worktreeHost: WorktreeHost,
  resolveWorktreePoolPath: () => Promise<string>,
  dispose: () => void
): ProjectProvider {
  const { ctx } = transportMeta;

  const transport: ProjectProviderTransport = {
    ...transportMeta,
    fs: projectFs,
    settings,
    worktreeHost,
  };

  const repository = new GitRepositoryService(repoGit, settings);
  const worktreeService = new WorktreeService({
    repoPath,
    projectSettings: settings,
    ctx,
    host: worktreeHost,
    resolveWorktreePoolPath,
    pathApi: transportMeta.kind === 'ssh' ? path.posix : path,
  });
  const gitFetchService = new GitFetchService(repoGit, hasGitHubToken, () =>
    repository.getBaseRemote()
  );
  gitFetchService.start();

  return new ProjectProvider(
    projectId,
    repoPath,
    transport,
    repository,
    worktreeService,
    gitFetchService,
    dispose
  );
}
