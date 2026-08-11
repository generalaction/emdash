import { observer } from 'mobx-react-lite';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import {
  getProjectStore,
  mountedProjectData,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { WorkspaceDetailPage } from '@core/features/workspaces/contributions/browser/workspace-detail-page';

/**
 * Project tab host for the shared workspace detail page: derives the scope from
 * the project's host (local or SSH machine) and, unlike the settings hosts,
 * stays put after a full delete — there is no list to navigate back to, the
 * page just shows its empty state.
 */
export const ProjectWorkspacesView = observer(function ProjectWorkspacesView({
  projectId,
}: {
  projectId: string;
}) {
  const project = mountedProjectData(getProjectStore(projectId));
  if (!project) return null;

  if (project.type === 'ssh') {
    const machinesStore = getMachinesStore();
    const machine = machinesStore.connections.find(
      (connection) => connection.id === project.connectionId
    );
    return (
      <WorkspaceDetailPage
        scope={{ kind: 'machine', machineId: project.connectionId }}
        connected={machine ? machinesStore.stateFor(machine.id) === 'connected' : false}
        machineName={machine?.name}
        projectId={projectId}
      />
    );
  }

  return <WorkspaceDetailPage scope={{ kind: 'local' }} connected projectId={projectId} />;
});
