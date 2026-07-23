import path from 'node:path';
import type { HostRef } from '@emdash/core/primitives/host/api';
import type { FsError } from '@emdash/core/runtimes/files/api';
import {
  isRuntimeResolveError,
  runtimeResolveErrorAsError,
  type RuntimeBroker,
  type RuntimeResolveError,
} from '@emdash/core/services/runtime-broker/api';
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
import type { IExecutionContext } from '@core/primitives/execution-context/api/execution-context';
import { projectHostRef, type Project } from '@core/primitives/projects/api';
import type { AppDb } from '@core/services/app-db/node/db';
import type {
  FilesRuntimeClient,
  GitRuntimeClient,
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
import { HostProjectSettingsProvider } from './settings/providers/host-project-settings-provider';

export type CreateProviderError = { type: 'error'; message: string } | RuntimeResolveError;

export type CreateProjectProviderDependencies = {
  db: AppDb;
  createExecutionContext(host: HostRef, root: string): IExecutionContext;
  createGitRepository(
    client: GitRuntimeClient,
    repository: ReturnType<typeof repositorySelector>,
    settings: HostProjectSettingsProvider
  ): GitRepositoryPort;
  createGitRepositoryFetch(
    client: GitRuntimeClient,
    repository: ReturnType<typeof repositorySelector>,
    getBaseRemote: () => Promise<string>
  ): GitRepositoryFetchPort;
  ensureAbsoluteDir(
    client: FilesRuntimeClient,
    rootPath: string,
    absolutePath: string,
    options?: { recursive?: boolean }
  ): Promise<Result<void, FsError>>;
  runtimes: Pick<RuntimeBroker, 'client'>;
  getProjectDefaults(): Promise<{
    defaultWorktreeDirectory: string;
    tmuxByDefault: boolean;
  }>;
  backfillGitHubAccount(provider: ProjectProvider): Promise<void>;
  taskSessions: Pick<TaskSessionManager, 'teardownAllForProject'>;
  workspacePlacement: WorkspacePlacementResolver;
};

export async function createProvider(
  dependencies: CreateProjectProviderDependencies,
  project: Project
): Promise<Result<ProjectProvider, CreateProviderError>> {
  try {
    const host = projectHostRef(project);
    const runtime = await dependencies.runtimes.client(host);
    if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
    const ctx = dependencies.createExecutionContext(host, project.path);
    const git = runtime.data.git;
    const filesClient = runtime.data.files;
    const workspace = runtime.data.workspace;
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
    const settings = new HostProjectSettingsProvider(
      project.id,
      project.path,
      project.baseRef,
      projectFiles,
      {
        git: gitInspector,
        getProjectDefaults: async () => ({
          tmuxByDefault: (await dependencies.getProjectDefaults()).tmuxByDefault,
        }),
        storage: new ProjectSettingsRepository(dependencies.db),
        defaultWorktreeDirectory: async () =>
          (await dependencies.getProjectDefaults()).defaultWorktreeDirectory,
        worktreeDirectoryFileSystem: {
          mkdir: async (targetPath, options) => {
            const result = await dependencies.ensureAbsoluteDir(
              filesClient,
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
      kind: project.type,
      defaultWorkspaceType:
        project.type === 'ssh'
          ? { kind: 'ssh', connectionId: project.connectionId }
          : { kind: 'local' },
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
  if (isRuntimeResolveError(error)) return error;
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
