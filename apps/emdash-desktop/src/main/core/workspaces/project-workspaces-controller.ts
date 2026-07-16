import { createRPCController } from '@shared/lib/ipc/rpc';
import { deleteProjectWorkspaces } from './operations/delete-project-workspaces';
import { listProjectWorkspaces } from './operations/list-project-workspaces';
import { measureProjectWorkspaces } from './operations/measure-project-workspaces';

export const projectWorkspacesController = createRPCController({
  listProjectWorkspaces,
  measureProjectWorkspaces,
  deleteProjectWorkspaces,
});
