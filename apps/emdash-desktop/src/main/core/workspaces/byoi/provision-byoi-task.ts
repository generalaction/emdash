import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import type { WorkspaceBootstrapResult } from '@main/core/workspaces/workspace-bootstrap-service';
import type { ProjectSettings } from '@shared/core/project-settings/project-settings';
import type { Task } from '@shared/core/tasks/tasks';

export type ProvisionBYOITaskParams = {
  task: Task;
  wpConfig: NonNullable<ProjectSettings['workspaceProvider']>;
  ctx: IExecutionContext;
  projectId: string;
  projectPath: string;
  settings: ProjectSettingsProvider;
  logPrefix: string;
  workspaceId: string;
};

export async function provisionBYOITask(
  _params: ProvisionBYOITaskParams
): Promise<WorkspaceBootstrapResult> {
  throw new Error(
    'Remote workspaces require the workspace server and are not supported by this build'
  );
}
