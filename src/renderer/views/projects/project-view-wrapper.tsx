import { createContext, useContext, type ReactNode } from 'react';
import {
  usePendingProjectsContext,
  type PendingProject,
} from '@renderer/components/add-project-modal/pending-projects-provider';
import { useProjectsContext } from '@renderer/core/projects/project-provider';
import type { Project } from '@renderer/types/app';
import { RepositoryProvider } from './repository-provider';

export type ProjectStatus = { status: 'creating'; pending: PendingProject } | { status: 'ready' };

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
  const { projects } = useProjectsContext();
  const { pendingProjects } = usePendingProjectsContext();
  const project = (projects.find((p) => p.id === projectId) ?? null) as Project | null;
  const pendingProject = pendingProjects.find((p) => p.id === projectId);
  const status: ProjectStatus = pendingProject
    ? { status: 'creating', pending: pendingProject }
    : { status: 'ready' };
  return (
    <CurrentProjectStatusContext.Provider value={status}>
      <RepositoryProvider projectId={projectId}>
        <CurrentProjectContext.Provider value={project}>{children}</CurrentProjectContext.Provider>
      </RepositoryProvider>
    </CurrentProjectStatusContext.Provider>
  );
}
