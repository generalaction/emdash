import { createContext, useContext, useEffect, type ReactNode } from 'react';
import {
  usePendingProjectsContext,
  type PendingProject,
} from '@renderer/components/add-project-modal/pending-projects-provider';
import { useProjectBootstrapContext } from '@renderer/core/projects/project-bootstrap-provider';
import { useProjectsDataContext } from '@renderer/core/projects/projects-data-provider';
import type { Project } from '@renderer/types/app';
import { RepositoryProvider } from './repository-provider';

export type ProjectStatus =
  | { status: 'creating'; pending: PendingProject }
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

export function ProjectViewWrapper({ children, projectId }: ProjectViewWrapperProps) {
  const { projects } = useProjectsDataContext();
  const { pendingProjects } = usePendingProjectsContext();
  const { entries, startTracking } = useProjectBootstrapContext();

  useEffect(() => {
    startTracking(projectId);
  }, [projectId, startTracking]);

  const project = (projects.find((p) => p.id === projectId) ?? null) as Project | null;
  const pendingProject = pendingProjects.find((p) => p.id === projectId);
  const bootstrapEntry = entries[projectId];

  const status: ProjectStatus = pendingProject
    ? { status: 'creating', pending: pendingProject }
    : bootstrapEntry?.status === 'bootstrapping'
      ? { status: 'bootstrapping' }
      : bootstrapEntry?.status === 'error'
        ? { status: 'error', message: bootstrapEntry.error ?? 'Bootstrap failed' }
        : { status: 'ready' };

  return (
    <CurrentProjectStatusContext.Provider value={status}>
      <RepositoryProvider projectId={projectId}>
        <CurrentProjectContext.Provider value={project}>{children}</CurrentProjectContext.Provider>
      </RepositoryProvider>
    </CurrentProjectStatusContext.Provider>
  );
}
