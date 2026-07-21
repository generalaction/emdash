import path from 'node:path';
import type { FsError } from '@emdash/core/runtimes/files/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import {
  ProjectProvider,
  type GitRepositoryFetchPort,
  type GitRepositoryPort,
  type ProjectProviderTransport,
} from '@core/features/projects/api/node/project-provider';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import type { WorkspacePlacementResolver } from '@core/features/workspaces/api/node/placement/workspace-placement-resolver';
import { nativePathFromHost, relativeRuntimePath } from '@core/primitives/desktop-runtime/api';
import { remoteRuntimeUnavailable } from '@core/primitives/desktop-runtime/api/runtime-errors';
import type { IExecutionContext } from '@core/primitives/execution-context/api/execution-context';
import type { LocalProject, SshProject } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import type {
  FilesRuntimeClient,
  GitRuntimeClient,
  WorkspaceRuntimeClient,
} from '@core/services/runtime-broker/api/clients';
import {
  fileKey,
  filesClientScope,
  fsErrorMessage,
} from '@core/services/runtime-broker/node/files';
import {
  checkoutSelector,
  gitFilePath,
  repositorySelector,
} from '@core/services/runtime-broker/node/git';
import { ensureEmdashGitExcludedSafe } from './ensure-emdash-excluded';
import { ProjectSettingsRepository } from './settings/project-settings-storage';
import { LocalProjectSettingsProvider } from './settings/providers/local-project-settings-provider';

export type CreateProviderError = { type: 'error'; message: string } | RuntimeResolveError;

export type CreateProjectProviderDependencies = {
  db: AppDb;
  createExecutionContext(root: string): IExecutionContext;
  createGitRepository(
    client: GitRuntimeClient,
    repository: ReturnType<typeof repositorySelector>,
    settings: LocalProjectSettingsProvider
  ): GitRepositoryPort;
  createGitRepositoryFetch(
    client: GitRuntimeClient,
    repository: ReturnType<typeof repositorySelector>,
    getBaseRemote: () => Promise<string>
  ): GitRepositoryFetchPort;
  ensureAbsoluteDir(
    rootPath: string,
    absolutePath: string,
    options?: { recursive?: boolean }
  ): Promise<Result<void, FsError>>;
  getFilesRuntimeClient(): Promise<FilesRuntimeClient>;
  getGitRuntimeClient(): Promise<GitRuntimeClient>;
  getLocalProjectDefaults(): Promise<{
    defaultWorktreeDirectory: string;
    tmuxByDefault: boolean;
  }>;
  getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient>;
  backfillGitHubAccount(provider: ProjectProvider): Promise<void>;
  taskSessions: Pick<TaskSessionManager, 'teardownAllForProject'>;
  workspacePlacement: WorkspacePlacementResolver;
};

export async function createProvider(
  dependencies: CreateProjectProviderDependencies,
  project: LocalProject | SshProject
): Promise<Result<ProjectProvider, CreateProviderError>> {
  if (project.type === 'ssh') {
    return err(remoteRuntimeUnavailable(project.connectionId, 'projects'));
  }
  return createLocalProvider(dependencies, project);
}

async function createLocalProvider(
  dependencies: CreateProjectProviderDependencies,
  project: LocalProject
): Promise<Result<ProjectProvider, CreateProviderError>> {
  try {
    const ctx = dependencies.createExecutionContext(project.path);
    const [git, filesClient, workspace] = await Promise.all([
      dependencies.getGitRuntimeClient(),
      dependencies.getFilesRuntimeClient(),
      dependencies.getWorkspaceRuntimeClient(),
    ]);
    const projectFiles = filesClientScope(filesClient, project.path);
    const repository = repositorySelector(project.path);
    const checkout = checkoutSelector(project.path);
    const gitInspector = {
      isFileCleanlyTracked: async (filePath: string) => {
        const relative = gitFilePath(relativeRuntimePath(checkout.checkout, filePath));
        const [index, status] = await Promise.all([
          git.checkout.getFileAtIndex({ ...checkout, filePath: relative }),
          git.checkout.model.state(checkout, 'status').snapshot(),
        ]);
        if (!index.success || index.data === null || status.data.kind !== 'ok') return false;
        const entry = status.data.entries[relative];
        return !entry || (entry.index === 'unmodified' && entry.worktree === 'unmodified');
      },
    };
    const settings = new LocalProjectSettingsProvider(
      project.id,
      project.path,
      project.baseRef,
      projectFiles,
      {
        git: gitInspector,
        getProjectDefaults: async () => ({
          tmuxByDefault: (await dependencies.getLocalProjectDefaults()).tmuxByDefault,
        }),
        storage: new ProjectSettingsRepository(dependencies.db),
        defaultWorktreeDirectory: async () =>
          (await dependencies.getLocalProjectDefaults()).defaultWorktreeDirectory,
        worktreeDirectoryFileSystem: {
          mkdir: async (targetPath, options) => {
            const result = await dependencies.ensureAbsoluteDir(
              path.dirname(targetPath),
              targetPath,
              options
            );
            return result.success ? ok() : err({ message: fsErrorMessage(result.error) });
          },
          realPath: async (targetPath) => {
            const targetFiles = filesClientScope(filesClient, targetPath);
            const result = await filesClient.fs.realPath(fileKey(targetFiles, targetPath));
            return result.success
              ? ok(nativePathFromHost(result.data))
              : err({ message: fsErrorMessage(result.error) });
          },
        },
      }
    );
    await settings.ensure({ git: gitInspector });

    const repositoryService = dependencies.createGitRepository(git, repository, settings);

    ensureEmdashGitExcludedSafe(projectFiles, project.path, project.id);

    const transport: ProjectProviderTransport = {
      kind: 'local',
      defaultWorkspaceType: { kind: 'local' },
      ctx,
      files: projectFiles,
      projectConfigPath: path.join(project.path, '.emdash.json'),
      resolveProjectPath: (relativePath) => path.join(project.path, relativePath),
      configPathForDirectory: (directoryPath) => path.join(directoryPath, '.emdash.json'),
      settings,
    };
    const fetchService = dependencies.createGitRepositoryFetch(git, repository, () =>
      repositoryService.getBaseRemote()
    );
    fetchService.start();

    const provider = new ProjectProvider(
      project,
      transport,
      repositoryService,
      fetchService,
      git,
      workspace,
      repository,
      dependencies.taskSessions,
      dependencies.workspacePlacement,
      () => {}
    );
    await backfillGitHubAccount(dependencies, provider);
    return ok(provider);
  } catch (error) {
    return err(toCreateProviderError(error));
  }
}

function toCreateProviderError(error: unknown): CreateProviderError {
  return { type: 'error', message: error instanceof Error ? error.message : String(error) };
}

async function backfillGitHubAccount(
  dependencies: CreateProjectProviderDependencies,
  provider: ProjectProvider
): Promise<void> {
  try {
    await dependencies.backfillGitHubAccount(provider);
  } catch (error) {
    log.warn('createProvider: failed to backfill project GitHub account', {
      projectId: provider.projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
