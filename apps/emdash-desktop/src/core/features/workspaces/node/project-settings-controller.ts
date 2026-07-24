import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { getEffectiveTaskSettings } from '@core/features/projects/api/node/settings/effective-task-settings';
import {
  acquireWorkspaceRuntime,
  type WorkspaceRuntimeIdentityResolver,
} from '@core/features/workspaces/api/node/runtime-access';
import type { ProjectSettingsLoadResult } from '@core/primitives/project-settings/api';

export function createProjectSettingsOperations(dependencies: {
  projects: Pick<ProjectSessionManager, 'getProject'>;
  runtimes: RuntimeBroker;
  workspaceIdentity: WorkspaceRuntimeIdentityResolver;
}) {
  async function getSettings(workspaceId: string): Promise<ProjectSettingsLoadResult> {
    const workspace = await acquireWorkspaceRuntime(
      dependencies.runtimes,
      dependencies.workspaceIdentity,
      workspaceId
    );
    if (!workspace) {
      return err({ type: 'not_found', entity: 'workspace', workspaceId });
    }

    const project = dependencies.projects.getProject(workspace.identity.projectId);
    if (!project) {
      return err({ type: 'not_found', entity: 'workspace', workspaceId });
    }
    return ok(
      await getEffectiveTaskSettings({
        projectSettings: project.settings,
        taskFiles: workspace.files,
        taskConfigPath: project.configPathForDirectory(workspace.identity.path),
      })
    );
  }

  return { getSettings };
}
