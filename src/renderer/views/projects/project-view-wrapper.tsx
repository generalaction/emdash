import { observer } from 'mobx-react-lite';
import { createContext, useContext, type ReactNode } from 'react';
import type { Project } from '@shared/projects';
import { UnregisteredProjectStore } from '@renderer/core/stores/project';
import {
  getProjectStore,
  projectViewKind,
  unmountedMountErrorMessage,
} from '@renderer/views/projects/project-view-state';
import { RepositoryProvider } from './repository-provider';

export type ProjectStatus =
  | { status: 'creating'; pending: UnregisteredProjectStore }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'ready' };

const CurrentProjectContext = createContext<Project | null>(null);
const CurrentProjectStatusContext = createContext<ProjectStatus>({ status: 'ready' });

export function useCurrentProject(): Project | null {
  return useContext(CurrentProjectContext);
}

export function useRequiredCurrentProject(): Project {
  const project = useContext(CurrentProjectContext);
  if (!project) {
    throw new Error('useRequiredCurrentProject must be used within a ProjectViewWrapper');
  }
  return project;
}

export function useCurrentProjectStatus(): ProjectStatus {
  return useContext(CurrentProjectStatusContext);
}

interface ProjectViewWrapperProps {
  children: ReactNode;
  projectId: string;
}

export const ProjectViewWrapper = observer(function ProjectViewWrapper({
  children,
  projectId,
}: ProjectViewWrapperProps) {
  const projectStore = getProjectStore(projectId);
  const kind = projectViewKind(projectStore);

  const projectData =
    projectStore?.state === 'mounted' || projectStore?.state === 'unmounted'
      ? (projectStore.data as Project)
      : null;

  const status: ProjectStatus =
    projectStore?.state === 'unregistered'
      ? { status: 'creating', pending: projectStore }
      : kind === 'bootstrapping'
        ? { status: 'bootstrapping' }
        : kind === 'mount_error'
          ? { status: 'error', message: unmountedMountErrorMessage(projectStore) }
          : { status: 'ready' };

  return (
    <CurrentProjectStatusContext.Provider value={status}>
      <RepositoryProvider projectId={projectId}>
        <CurrentProjectContext.Provider value={projectData}>
          {children}
        </CurrentProjectContext.Provider>
      </RepositoryProvider>
    </CurrentProjectStatusContext.Provider>
  );
});
