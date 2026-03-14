import { createContext, useContext, type ReactNode } from 'react';
import { usePendingProjectsContext } from '@renderer/components/add-project-modal/pending-projects-provider';
import { useProjectManagementContext } from '@renderer/contexts/ProjectsProvider';
import type { Project } from '@renderer/types/app';
import { RepositoryProvider } from './repository-provider';

export type ProjectStatus = 'creating' | 'ready';

const CurrentProjectContext = createContext<Project | null>(null);
const CurrentProjectStatusContext = createContext<ProjectStatus>('ready');

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
  const { projects } = useProjectManagementContext();
  const { pendingProjects } = usePendingProjectsContext();
  const project = (projects.find((p) => p.id === projectId) ?? null) as Project | null;
  const status: ProjectStatus = pendingProjects.some((p) => p.id === projectId)
    ? 'creating'
    : 'ready';
  return (
    <CurrentProjectStatusContext.Provider value={status}>
      <RepositoryProvider projectId={projectId}>
        <CurrentProjectContext.Provider value={project}>{children}</CurrentProjectContext.Provider>
      </RepositoryProvider>
    </CurrentProjectStatusContext.Provider>
  );
}
