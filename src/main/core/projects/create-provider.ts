import fs from 'node:fs';
import path from 'node:path';
import { bareRefName } from '@shared/git-utils';
import type { LocalProject, SshProject } from '@shared/projects';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import {
  sshConnectionManager,
  type SshConnectionEvent,
} from '@main/core/ssh/ssh-connection-manager';
import { getGitLocalExec, getGitSshExec, getLocalExec, getSshExec } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { ProjectProvider } from './project-provider';
import {
  LocalProjectSettingsProvider,
  SshProjectSettingsProvider,
} from './settings/project-settings';
import { LocalWorktreeHost } from './worktrees/hosts/local-worktree-host';
import { SshWorktreeHost } from './worktrees/hosts/ssh-worktree-host';
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
  const exec = getLocalExec();
  const gitExec = getGitLocalExec(() => githubConnectionService.getToken());
  const settings = new LocalProjectSettingsProvider(project.path, bareRefName(project.baseRef));
  const worktreePoolPath = path.join(await settings.getWorktreeDirectory(), project.name);
  await fs.promises.mkdir(worktreePoolPath, { recursive: true });
  const worktreeHost = await LocalWorktreeHost.create({ allowedRoots: [project.path] });

  const transport = {
    kind: 'local' as const,
    defaultWorkspaceType: { kind: 'local' as const },
    exec,
    gitExec,
    fs: localFs,
    settings,
    worktreeHost,
    worktreePoolPath,
  };

  const repoGit = new GitService(project.path, gitExec, localFs);
  const repository = new GitRepositoryService(repoGit, settings);
  const worktreeService = new WorktreeService({
    worktreePoolPath,
    repoPath: project.path,
    projectSettings: settings,
    exec: gitExec,
    host: worktreeHost,
  });
  const gitFetchService = new GitFetchService(repoGit, hasGitHubToken);
  gitFetchService.start();

  const dispose = () => {};

  return new ProjectProvider(
    project.id,
    project.path,
    transport,
    repository,
    worktreeService,
    gitFetchService,
    dispose
  );
}

async function createSshProvider(project: SshProject): Promise<ProjectProvider> {
  try {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    const rootFs = new SshFileSystem(proxy, '/');
    const projectFs = new SshFileSystem(proxy, project.path);
    const exec = getSshExec(proxy);
    const gitExec = getGitSshExec(proxy, () => githubConnectionService.getToken());

    const settings = new SshProjectSettingsProvider(
      projectFs,
      bareRefName(project.baseRef),
      rootFs,
      project.path,
      exec
    );
    const worktreePoolPath = path.posix.join(await settings.getWorktreeDirectory(), project.name);
    const worktreeHost = new SshWorktreeHost(rootFs);
    await worktreeHost.mkdirAbsolute(worktreePoolPath, { recursive: true });

    const transport = {
      kind: 'ssh' as const,
      defaultWorkspaceType: { kind: 'ssh' as const, proxy, connectionId: project.connectionId },
      exec,
      gitExec,
      fs: projectFs,
      settings,
      worktreeHost,
      worktreePoolPath,
    };

    // SSH: disable local-filesystem git operations (CatFileBatch and streaming status)
    const repoGit = new GitService(project.path, gitExec, projectFs, false);
    const repository = new GitRepositoryService(repoGit, settings);
    const worktreeService = new WorktreeService({
      worktreePoolPath,
      repoPath: project.path,
      projectSettings: settings,
      exec: gitExec,
      host: worktreeHost,
    });
    const gitFetchService = new GitFetchService(repoGit, hasGitHubToken);
    gitFetchService.start();

    // Wire reconnect handler now that fetchService is in scope — no deferred injection needed.
    const handler = (evt: SshConnectionEvent) => {
      if (evt.type === 'reconnected' && evt.connectionId === project.connectionId) {
        void gitFetchService.fetch();
      }
    };
    sshConnectionManager.on('connection-event', handler);
    const dispose = () => sshConnectionManager.off('connection-event', handler);

    return new ProjectProvider(
      project.id,
      project.path,
      transport,
      repository,
      worktreeService,
      gitFetchService,
      dispose
    );
  } catch (error) {
    log.warn('createSshProvider: SSH connection failed', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
