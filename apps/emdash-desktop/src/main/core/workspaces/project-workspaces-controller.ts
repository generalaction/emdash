import { deleteProjectWorkspaces } from './operations/delete-project-workspaces';
import { listProjectWorkspaces } from './operations/list-project-workspaces';
import { measureProjectWorkspaces } from './operations/measure-project-workspaces';

export const projectWorkspaceOperations = {
  listProjectWorkspaces,
  measureProjectWorkspaces,
  deleteProjectWorkspaces,
};
