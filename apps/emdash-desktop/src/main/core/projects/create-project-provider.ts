import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { fileKey, filesClientScope, fsErrorMessage } from '@main/core/files/runtime-client';
import { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import { GitRepositoryService } from '@main/core/git/repository/service';
import { checkoutSelector, gitFilePath, repositorySelector } from '@main/core/git/runtime-client';
import { projectGitHubAccountBackfillService } from '@main/core/github/services/project-github-account-backfill-instance';
import { ensureAbsoluteDir } from '@main/core/runtime/files-helpers';
import { LocalWorkspaceSetupExecutor } from '@main/core/workspaces/local-workspace-setup-executor';
import { applyRecovery } from '@main/core/workspaces/recovery-strategy';
import { getFilesRuntimeClient } from '@main/gateway/accessors';
import { getGitRuntimeClient } from '@main/gateway/accessors';
import { log } from '@main/lib/logger';
import { nativePathFromHost, relativeRuntimePath } from '@shared/core/runtime/paths';
import { safePathSegment } from '@shared/path-name';
import type { LocalProject, SshProject } from '@shared/projects';
import { ensureEmdashGitExcludedSafe } from './ensure-emdash-excluded';
import { ProjectProvider, type ProjectProviderTransport } from './project-provider';
import { LocalProjectSettingsProvider } from './settings/providers/local-project-settings-provider';
import { WorktreeService } from './worktrees/worktree-service';

export type CreateProviderError = { message: string };

export async function createProvider(
  project: LocalProject | SshProject
): Promise<Result<ProjectProvider, CreateProviderError>> {
  if (project.type === 'ssh') {
    return err({
      message: 'Remote projects require the workspace server and are not supported by this build',
    });
  }
  return createLocalProvider(project);
}

async function createLocalProvider(
  project: LocalProject
): Promise<Result<ProjectProvider, CreateProviderError>> {
  try {
    const ctx = new LocalExecutionContext({ root: project.path });
    const [git, filesClient] = await Promise.all([getGitRuntimeClient(), getFilesRuntimeClient()]);
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
        worktreeDirectoryFileSystem: {
          mkdir: async (targetPath, options) => {
            const result = await ensureAbsoluteDir(path.dirname(targetPath), targetPath, options);
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

    const worktreeDirectory = await settings.getWorktreeDirectory();
    const madeWorktreeDirectory = await ensureAbsoluteDir(
      path.dirname(worktreeDirectory),
      worktreeDirectory
    );
    if (!madeWorktreeDirectory.success) {
      return err({ message: `Failed to create worktree directory: ${worktreeDirectory}` });
    }

    const resolveWorktreePoolPath = async () =>
      path.join(await settings.getWorktreeDirectory(), safePathSegment(project.name, project.id));
    const worktreeService = new WorktreeService({
      repoPath: project.path,
      projectSettings: settings,
      git,
      files: filesClient,
      repository,
      checkout,
      resolveWorktreePoolPath,
    });
    const repositoryService = new GitRepositoryService(git, repository, settings);

    ensureEmdashGitExcludedSafe(projectFiles, project.path, project.id);

    const transport: ProjectProviderTransport = {
      kind: 'local',
      defaultWorkspaceType: { kind: 'local' },
      ctx,
      files: projectFiles,
      projectConfigPath: path.join(project.path, '.emdash.json'),
      resolveProjectPath: (relativePath) => path.join(project.path, relativePath),
      configPathForDirectory: (directoryPath) => path.join(directoryPath, '.emdash.json'),
      runWorkspaceSetup: async ({ spec, worktreePoolPath }) => {
        const stepCtx = {
          ctx,
          repoPath: project.path,
          worktreePoolPath,
          files: projectFiles,
          git,
          repository,
          checkout,
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
    const fetchService = new GitRepositoryFetchService(git, repository, () =>
      repositoryService.getBaseRemote()
    );
    fetchService.start();

    const provider = new ProjectProvider(
      project.id,
      project.path,
      transport,
      repositoryService,
      worktreeService,
      fetchService,
      git,
      repository,
      () => {}
    );
    await backfillGitHubAccount(provider);
    return ok(provider);
  } catch (error) {
    return err(toCreateProviderError(error));
  }
}

function toCreateProviderError(error: unknown): CreateProviderError {
  return { message: error instanceof Error ? error.message : String(error) };
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
