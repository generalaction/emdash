import type { IFileSystem } from '@emdash/core/files';
import type { IGitRepository, IGitRuntime } from '@emdash/core/git';
import { err, ok, type Lease, type Result } from '@emdash/shared';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import { GitRepositoryService } from '@main/core/git/repository/service';
import { projectGitHubAccountBackfillService } from '@main/core/github/services/project-github-account-backfill-instance';
import {
  absoluteDirectoryFileSystem,
  ensureAbsoluteDir,
  openFileSystem,
} from '@main/core/runtime/files-helpers';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import type { MachineRef, MachineRuntime } from '@main/core/runtime/types';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import type { SshConnectionManagerEvent } from '@main/core/ssh/lifecycle/ssh-connection-manager';
import { LocalWorkspaceSetupExecutor } from '@main/core/workspaces/local-workspace-setup-executor';
import { applyRecovery } from '@main/core/workspaces/recovery-strategy';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { gitRepoUpdateChannel } from '@shared/core/git/events';
import { safePathSegment } from '@shared/path-name';
import type { LocalProject, SshProject } from '@shared/projects';
import { ensureEmdashGitExcludedSafe } from './ensure-emdash-excluded';
import { ProjectProvider, type ProjectProviderTransport } from './project-provider';
import type { ProjectSettingsProvider } from './settings/provider';
import { LocalProjectSettingsProvider } from './settings/providers/local-project-settings-provider';
import { SshProjectSettingsProvider } from './settings/providers/ssh-project-settings-provider';
import { WorktreeService } from './worktrees/worktree-service';

export type CreateProviderError = { message: string };

export async function createProvider(
  project: LocalProject | SshProject
): Promise<Result<ProjectProvider, CreateProviderError>> {
  return project.type === 'ssh' ? createSshProvider(project) : createLocalProvider(project);
}

async function createLocalProvider(
  project: LocalProject
): Promise<Result<ProjectProvider, CreateProviderError>> {
  const ctx = new LocalExecutionContext({ root: project.path });
  const projectMachine: MachineRef = { kind: 'local' };
  const runtimeLease = await runtimeManager.acquire(projectMachine);

  try {
    const projectFileSystem = openFileSystem(runtimeLease.value.files);
    if (!projectFileSystem.success) {
      await runtimeLease.release();
      return err({ message: projectFileSystem.error.message });
    }
    const settings = new LocalProjectSettingsProvider(
      project.id,
      project.path,
      project.baseRef,
      projectFileSystem.data
    );
    await runLegacyProjectSettingsMigration(settings, runtimeLease.value.git, project.path);
    const worktreeDirectory = await settings.getWorktreeDirectory();
    const madeWorktreeDir = await ensureAbsoluteDir(runtimeLease.value.files, worktreeDirectory);
    if (!madeWorktreeDir.success) {
      await runtimeLease.release();
      return err({ message: madeWorktreeDir.error.message });
    }
    const resolveWorktreePoolPath = async () => {
      const directory = await settings.getWorktreeDirectory();
      return runtimeLease.value.files.path.join(
        directory,
        safePathSegment(project.name, project.id)
      );
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
        runtimeLease.value.files,
        projectFileSystem.data,
        settings,
        resolveWorktreePoolPath,
        () => {},
        runtimeLease,
        repoLease
      );
      await backfillGitHubAccount(provider);
      return ok(provider);
    } catch (error) {
      await repoLease.release();
      throw error;
    }
  } catch (error) {
    await runtimeLease.release();
    return err(toCreateProviderError(error));
  }
}

async function createSshProvider(
  project: SshProject
): Promise<Result<ProjectProvider, CreateProviderError>> {
  try {
    const proxy = await sshConnectionManager.connect(project.connectionId);

    const baseCtx = new SshExecutionContext(proxy, { root: project.path });
    const ctx = baseCtx;
    const projectMachine: MachineRef = { kind: 'ssh', connectionId: project.connectionId };
    const runtimeLease = await runtimeManager.acquire(projectMachine);
    const projectFileSystem = openFileSystem(runtimeLease.value.files);
    if (!projectFileSystem.success) {
      await runtimeLease.release();
      return err({ message: projectFileSystem.error.message });
    }

    const settings = new SshProjectSettingsProvider(
      project.id,
      projectFileSystem.data,
      project.baseRef,
      absoluteDirectoryFileSystem(runtimeLease.value.files),
      project.path,
      baseCtx
    );

    try {
      await runLegacyProjectSettingsMigration(settings, runtimeLease.value.git, project.path);
      const worktreeDirectory = await settings.getWorktreeDirectory();
      const worktreePoolPath = runtimeLease.value.files.path.join(worktreeDirectory, project.name);
      const madeWorktreePool = await ensureAbsoluteDir(runtimeLease.value.files, worktreePoolPath);
      if (!madeWorktreePool.success) {
        await runtimeLease.release();
        return err({ message: madeWorktreePool.error.message });
      }
      const resolveWorktreePoolPath = async () =>
        runtimeLease.value.files.path.join(await settings.getWorktreeDirectory(), project.name);

      let provider: ProjectProvider | undefined;
      const handler = (evt: SshConnectionManagerEvent) => {
        if (evt.type === 'reconnected' && evt.connectionId === project.connectionId) {
          void provider?.gitRepositoryFetchService.fetch();
        }
      };
      const dispose = () => {
        sshConnectionManager.off('connection-event', handler);
      };

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
          runtimeLease.value.files,
          projectFileSystem.data,
          settings,
          resolveWorktreePoolPath,
          dispose,
          runtimeLease,
          repoLease
        );
        await backfillGitHubAccount(provider);

        // Wire reconnect handler after provider is built so gitRepositoryFetchService is available.
        sshConnectionManager.on('connection-event', handler);

        return ok(provider);
      } catch (error) {
        await repoLease.release();
        throw error;
      }
    } catch (error) {
      await runtimeLease.release();
      throw error;
    }
  } catch (error) {
    log.warn('createSshProvider: SSH connection failed', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
    sshConnectionManager.reportChannelError(project.connectionId, error);
    return err(toCreateProviderError(error));
  }
}

function toCreateProviderError(error: unknown): CreateProviderError {
  return { message: error instanceof Error ? error.message : String(error) };
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
    await lease.release();
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
  files: MachineRuntime['files'],
  projectFileSystem: IFileSystem,
  settings: ProjectSettingsProvider,
  resolveWorktreePoolPath: () => Promise<string>,
  dispose: () => void | Promise<void>,
  runtimeLease: Lease<MachineRuntime>,
  repoLease: Lease<IGitRepository>
): ProjectProvider {
  const { ctx } = transportMeta;

  // Keep emdash's `.emdash/` runtime state (worktree pool, attachments, uploads) out of
  // the user's `git status`. Best effort and non-blocking.
  ensureEmdashGitExcludedSafe(projectFileSystem, repoPath, projectId);

  const gitRepository = new GitRepositoryService(repoLease.value, settings);
  const worktreeService = new WorktreeService({
    repoPath,
    projectSettings: settings,
    ctx,
    files,
    resolveWorktreePoolPath,
  });
  const transport: ProjectProviderTransport = {
    ...transportMeta,
    fileSystem: projectFileSystem,
    projectConfigPath: files.path.join(repoPath, '.emdash.json'),
    resolveProjectPath: (relativePath) => files.path.join(repoPath, relativePath),
    configPathForDirectory: (directoryPath) => files.path.join(directoryPath, '.emdash.json'),
    runWorkspaceSetup: async ({ spec, worktreePoolPath }) => {
      const stepCtx = {
        ctx,
        repoPath,
        worktreePoolPath,
        files,
        projectSettings: settings,
        worktreeService,
      };
      const executor = new LocalWorkspaceSetupExecutor(stepCtx);
      let setupResult = await executor.execute(spec);
      if (!setupResult.success) {
        const recovery = await applyRecovery(setupResult.error, stepCtx);

        if (recovery.kind === 'resolved') {
          setupResult = ok({ path: recovery.path, warnings: [] });
        } else if (recovery.kind === 'retry') {
          setupResult = await executor.execute(spec);
        }
      }
      return setupResult;
    },
    settings,
  };
  const gitRepositoryFetchService = new GitRepositoryFetchService(gitRepository, () =>
    gitRepository.getBaseRemote()
  );
  gitRepositoryFetchService.start();
  const unsubscribeRepoUpdates = repoLease.value.subscribe((update) => {
    events.emit(gitRepoUpdateChannel, { projectId, update });
  });

  const releaseProjectLeases = async () => {
    unsubscribeRepoUpdates();
    await repoLease.release();
    await runtimeLease.release();
  };

  const provider = new ProjectProvider(
    projectId,
    repoPath,
    transport,
    gitRepository,
    worktreeService,
    gitRepositoryFetchService,
    runtimeLease.value.git,
    async () => {
      await releaseProjectLeases();
      await dispose();
    }
  );
  return provider;
}
