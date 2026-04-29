import fs from 'node:fs';
import path from 'node:path';
import { bareRefName } from '@shared/git-utils';
import type { LocalProject, SshProject } from '@shared/projects';
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
import {
  sshConnectionManager,
  type SshConnectionEvent,
} from '@main/core/ssh/ssh-connection-manager';
import { log } from '@main/lib/logger';
import { ProjectProvider, type ProjectProviderTransport } from './project-provider';
import {
  LocalProjectSettingsProvider,
  SshProjectSettingsProvider,
} from './settings/project-settings';
import type { ProjectSettingsProvider } from './settings/schema';
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
  const ctx = new GitHubAuthExecutionContext(baseCtx, () => githubConnectionService.getToken());

  const settings = new LocalProjectSettingsProvider(project.path, bareRefName(project.baseRef));
  const worktreeDirectory = await settings.getWorktreeDirectory();
  await fs.promises.mkdir(worktreeDirectory, { recursive: true });
  const worktreePoolPath = path.join(worktreeDirectory, project.name);
  const worktreeHost = await LocalWorktreeHost.create({
    allowedRoots: [project.path, worktreeDirectory],
  });

  return buildProvider(
    project.id,
    project.path,
    { kind: 'local', defaultWorkspaceType: { kind: 'local' }, ctx },
    localFs,
    settings,
    worktreeHost,
    worktreePoolPath,
    () => {}
  );
}

async function createSshProvider(project: SshProject): Promise<ProjectProvider> {
  try {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    const rootFs = new SshFileSystem(proxy, '/');
    const projectFs = new SshFileSystem(proxy, project.path);

    const baseCtx = new SshExecutionContext(proxy, { root: project.path });
    const ctx = new GitHubAuthExecutionContext(baseCtx, () => githubConnectionService.getToken());

    const settings = new SshProjectSettingsProvider(
      projectFs,
      bareRefName(project.baseRef),
      rootFs,
      project.path,
      baseCtx
    );
    const worktreePoolPath = path.posix.join(await settings.getWorktreeDirectory(), project.name);
    const worktreeHost = new SshWorktreeHost(rootFs);
    await worktreeHost.mkdirAbsolute(worktreePoolPath, { recursive: true });

    const dispose = () => sshConnectionManager.off('connection-event', handler);

    const provider = buildProvider(
      project.id,
      project.path,
      {
        kind: 'ssh',
        defaultWorkspaceType: { kind: 'ssh', proxy, connectionId: project.connectionId },
        ctx,
      },
      projectFs,
      settings,
      worktreeHost,
      worktreePoolPath,
      dispose
    );

    // Wire reconnect handler after provider is built so gitFetchService is available.
    const handler = (evt: SshConnectionEvent) => {
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
    throw error;
  }
}

function buildProvider(
  projectId: string,
  repoPath: string,
  transportMeta: Pick<ProjectProviderTransport, 'kind' | 'defaultWorkspaceType' | 'ctx'>,
  projectFs: FileSystemProvider,
  settings: ProjectSettingsProvider,
  worktreeHost: WorktreeHost,
  worktreePoolPath: string,
  dispose: () => void
): ProjectProvider {
  const { ctx } = transportMeta;

  const transport: ProjectProviderTransport = {
    ...transportMeta,
    fs: projectFs,
    settings,
    worktreeHost,
    worktreePoolPath,
  };

  const repoGit = new GitService(ctx, projectFs);
  const repository = new GitRepositoryService(repoGit, settings);
  const worktreeService = new WorktreeService({
    worktreePoolPath,
    repoPath,
    projectSettings: settings,
    ctx,
    host: worktreeHost,
  });
  const gitFetchService = new GitFetchService(repoGit, hasGitHubToken);
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
