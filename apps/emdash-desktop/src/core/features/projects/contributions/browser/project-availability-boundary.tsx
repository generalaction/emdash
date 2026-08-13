import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import { getMachinesStore } from '@core/features/machines/contributions/app-stores';
import {
  asAvailableProject,
  getProjectStore,
} from '@core/features/projects/api/browser/stores/project-selectors';
import { ProjectAvailabilityFrame } from '@core/features/projects/browser/components/project-availability-banner';

export const ProjectAvailabilityBoundary = observer(function ProjectAvailabilityBoundary({
  children,
  projectId,
}: {
  children: ReactNode;
  projectId: string;
}) {
  const context = asAvailableProject(getProjectStore(projectId));
  if (!context) return children;

  const project = context.project;
  const machineName =
    project.type === 'ssh'
      ? getMachinesStore().connections.find((connection) => connection.id === project.connectionId)
          ?.name
      : undefined;
  return (
    <ProjectAvailabilityFrame
      project={project}
      state={context.host.state}
      machineName={machineName}
      onRecover={() => context.host.recover()}
    >
      {children}
    </ProjectAvailabilityFrame>
  );
});
