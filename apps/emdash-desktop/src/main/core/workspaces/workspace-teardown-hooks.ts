import type { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import { workspaceFileIndexService } from '@main/core/search/workspace-file-index-service';
import { runLifecycleScriptWithPolicy } from '@main/core/terminals/lifecycle-script-coordinator';
import type { Workspace } from '@main/core/workspaces/workspace';
import { getEffectiveTaskSettings } from '../projects/settings/effective-task-settings';
import { TEARDOWN_SCRIPT_WAIT_MS } from '../tasks/provision-task-error';

type WorkspaceTeardownExtraHooks = {
  onDestroy?: (workspace: Workspace) => Promise<void>;
  onDetach?: (workspace: Workspace) => Promise<void>;
};

/**
 * Builds workspace shutdown behaviors while keeping the user lifecycle teardown distinct
 * from destructive provider cleanup. This lets delete-after-archive destroy provider state
 * without running the same `.emdash.json` teardown script twice.
 */
export function createWorkspaceTeardownHooks({
  workspaceId,
  projectId,
  taskId,
  settings,
  ownsFetchService,
  gitRepositoryFetchService,
  extraHooks,
  logPrefix,
}: {
  workspaceId: string;
  projectId: string;
  taskId: string;
  settings: ProjectSettingsProvider;
  ownsFetchService: boolean;
  gitRepositoryFetchService: Pick<GitRepositoryFetchService, 'stop'>;
  extraHooks?: WorkspaceTeardownExtraHooks;
  logPrefix: string;
}) {
  const runWorkspaceTeardown = async (workspace: Workspace) => {
    await previewServerService.stopForWorkspace(projectId, workspaceId);
    if (ownsFetchService) {
      gitRepositoryFetchService.stop();
    }
    workspaceFileIndexService.onWorkspaceDeactivated(workspaceId);
    const latestProjectSettings = await settings.get();
    const latestTaskSettings = await getEffectiveTaskSettings({
      projectSettings: settings,
      taskFs: workspace.fileSystem,
      taskConfigPath: workspace.configPath,
    });
    const latestShellSetup = latestTaskSettings.shellSetup ?? latestProjectSettings.shellSetup;
    const teardownScript = latestTaskSettings.scripts?.teardown;

    if (teardownScript) {
      await runLifecycleScriptWithPolicy({
        workspace,
        projectId,
        taskId,
        workspaceId,
        type: 'teardown',
        script: teardownScript,
        shellSetup: latestShellSetup,
        origin: 'workspace-destroy',
        policy: {
          timeoutMs: TEARDOWN_SCRIPT_WAIT_MS,
          logFailure: true,
          surfaceFailure: false,
          continueOnFailure: true,
        },
        logPrefix,
      });
    }
  };

  return {
    onArchive: async (workspace: Workspace) => {
      await runWorkspaceTeardown(workspace);
      await extraHooks?.onDetach?.(workspace);
    },
    onDestroy: async (workspace: Workspace) => {
      await runWorkspaceTeardown(workspace);
      await extraHooks?.onDestroy?.(workspace);
    },
    onProviderDestroy: async (workspace: Workspace) => {
      await extraHooks?.onDestroy?.(workspace);
    },
    onDetach: async (workspace: Workspace) => {
      await previewServerService.stopForWorkspace(projectId, workspaceId);
      await extraHooks?.onDetach?.(workspace);
    },
  };
}
