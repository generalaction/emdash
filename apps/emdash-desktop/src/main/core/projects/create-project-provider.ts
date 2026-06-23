import fs from 'node:fs';
import path from 'node:path';
import type { IGitRepository, IGitRuntime } from '@emdash/core/git';
import type { Lease } from '@emdash/shared';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import { GitRepositoryService } from '@main/core/git/repository/service';
import { projectGitHubAccountBackfillService } from '@main/core/github/services/project-github-account-backfill-instance';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import type { MachineRef, MachineRuntime } from '@main/core/runtime/types';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import type { SshConnectionManagerEvent } from '@main/core/ssh/lifecycle/ssh-connection-manager';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { gitRepoUpdateChannel } from '@shared/core/git/events';
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

export async function createProvider(project: LocalProject | SshProject): Promise<ProjectProvider> {
  if (project.type === 'ssh') {
    return createSshProvider(project);
  }
  return createLocalProvider(project);
}

async function createLocalProvider(project: LocalProject): Promise<ProjectProvider> {
  const localFs = new LocalFileSystem(project.path);
  const ctx = new LocalExecutionContext({ root: project.path });
  const projectMachine: MachineRef = { kind: 'local' };
  const runtimeLease = await runtimeManager.acquire(projectMachine);

  const settings = new LocalProjectSettingsProvider(project.id, project.path, project.baseRef);

  try {
    await runLegacyProjectSettingsMigration(settings, runtimeLease.value.git, project.path);
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

    const repoLease = await runtimeLease.value.git.openRepository(project.path);
    try {
      const provider = buildProvider(
        project.id,
        project.path,
        {
          kind: 'local',
          projectMachine,
          defaultWorkspaceType: { kind: 'local' },
          defaultWorkspaceMachine: projectMachine,
          ctx,
        },
        localFs,
        settings,
        worktreeHost,
        resolveWorktreePoolPath,
        () => {},
        runtimeLease,
        repoLease
      );
      await backfillGitHubAccount(provider);
      return provider;
    } catch (error) {
      repoLease.release();
      throw error;
    }
  } catch (error) {
    runtimeLease.release();
    throw error;
  }
}

async function createSshProvider(project: SshProject): Promise<ProjectProvider> {
  try {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    const rootFs = new SshFileSystem(proxy, '/');
    const projectFs = new SshFileSystem(proxy, project.path);

    const baseCtx = new SshExecutionContext(proxy, { root: project.path });
    const ctx = baseCtx;
    const projectMachine: MachineRef = { kind: 'ssh', connectionId: project.connectionId };
    const runtimeLease = await runtimeManager.acquire(projectMachine);

    const settings = new SshProjectSettingsProvider(
      project.id,
      projectFs,
      project.baseRef,
      rootFs,
      project.path,
      baseCtx
    );

    try {
      await runLegacyProjectSettingsMigration(settings, runtimeLease.value.git, project.path);
      const worktreeDirectory = await settings.getWorktreeDirectory();
      const worktreePoolPath = path.posix.join(worktreeDirectory, project.name);
      const worktreeHost = new SshWorktreeHost(rootFs);
      await worktreeHost.mkdirAbsolute(worktreePoolPath, { recursive: true });
      const resolveWorktreePoolPath = async () =>
        path.posix.join(await settings.getWorktreeDirectory(), project.name);

      let provider: ProjectProvider | undefined;
      const handler = (evt: SshConnectionManagerEvent) => {
        if (evt.type === 'reconnected' && evt.connectionId === project.connectionId) {
          void provider?.gitRepositoryFetchService.fetch();
        }
      };
      const dispose = () => sshConnectionManager.off('connection-event', handler);

      const repoLease = await runtimeLease.value.git.openRepository(project.path);
      try {
        provider = buildProvider(
          project.id,
          project.path,
          {
            kind: 'ssh',
            projectMachine,
            defaultWorkspaceType: { kind: 'ssh', proxy, connectionId: project.connectionId },
            defaultWorkspaceMachine: projectMachine,
            ctx,
          },
          projectFs,
          settings,
          worktreeHost,
          resolveWorktreePoolPath,
          dispose,
          runtimeLease,
          repoLease
        );
        await backfillGitHubAccount(provider);

        // Wire reconnect handler after provider is built so gitRepositoryFetchService is available.
        sshConnectionManager.on('connection-event', handler);

        return provider;
      } catch (error) {
        repoLease.release();
        throw error;
      }
    } catch (error) {
      runtimeLease.release();
      throw error;
    }
  } catch (error) {
    log.warn('createSshProvider: SSH connection failed', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
    sshConnectionManager.reportChannelError(project.connectionId, error);
    throw error;
  }
}

async function runLegacyProjectSettingsMigration(
  settings: LocalProjectSettingsProvider | SshProjectSettingsProvider,
  git: IGitRuntime,
  repoPath: string
): Promise<void> {
  const lease = await git.openWorktree(repoPath);
  try {
    await settings.ensure({ git: lease.value });
  } finally {
    lease.release();
  }
}

async function backfillGitHubAccount(provider: ProjectProvider): Promise<void> {
  try {
    await projectGitHubAccountBackfillService.backfillProject(provider);
  } catch (error) {
    log.warn('createProvider: failed to backfill project GitHub account', {
      projectId: provider.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildProvider(
  projectId: string,
  repoPath: string,
  transportMeta: Pick<
    ProjectProviderTransport,
    'kind' | 'projectMachine' | 'defaultWorkspaceType' | 'defaultWorkspaceMachine' | 'ctx'
  >,
  projectFs: FileSystemProvider,
  settings: ProjectSettingsProvider,
  worktreeHost: WorktreeHost,
  resolveWorktreePoolPath: () => Promise<string>,
  dispose: () => void,
  runtimeLease: Lease<MachineRuntime>,
  repoLease: Lease<IGitRepository>
): ProjectProvider {
  const { ctx } = transportMeta;

  const transport: ProjectProviderTransport = {
    ...transportMeta,
    fs: projectFs,
    settings,
    worktreeHost,
  };

  const gitRepository = new GitRepositoryService(repoLease.value, settings);
  const worktreeService = new WorktreeService({
    repoPath,
    projectSettings: settings,
    ctx,
    host: worktreeHost,
    resolveWorktreePoolPath,
  });
  const gitRepositoryFetchService = new GitRepositoryFetchService(gitRepository, () =>
    gitRepository.getBaseRemote()
  );
  gitRepositoryFetchService.start();
  const unsubscribeRepoUpdates = repoLease.value.subscribe((update) => {
    events.emit(gitRepoUpdateChannel, { projectId, update });
  });

  const releaseGitRuntime = () => {
    unsubscribeRepoUpdates();
    repoLease.release();
    runtimeLease.release();
  };

  return new ProjectProvider(
    projectId,
    repoPath,
    transport,
    gitRepository,
    worktreeService,
    gitRepositoryFetchService,
    runtimeLease.value.git,
    () => {
      gitRepositoryFetchService.stop();
      releaseGitRuntime();
      dispose();
    }
  );
}
