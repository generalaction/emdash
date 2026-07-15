import { createRPCController } from '@shared/lib/ipc/rpc';
import { cleanWorkspaceArtifacts } from './operations/clean-workspace-artifacts';
import { deleteProjectWorkspaces } from './operations/delete-project-workspaces';
import { listProjectWorkspaces } from './operations/list-project-workspaces';

export const projectWorkspacesController = createRPCController({
  listProjectWorkspaces,
  cleanWorkspaceArtifacts,
  deleteProjectWorkspaces,
});
