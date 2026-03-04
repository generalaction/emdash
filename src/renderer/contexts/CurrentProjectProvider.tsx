import { createContext, useContext, type ReactNode } from 'react';
import type { Project } from '../types/app';
import { useProjectManagementContext } from './ProjectManagementProvider';

const CurrentProjectContext = createContext<Project | null>(null);

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

interface ProjectViewWrapperProps {
  children: ReactNode;
  projectId: string;
}

export function ProjectViewWrapper({ children, projectId }: ProjectViewWrapperProps) {
  const { projects } = useProjectManagementContext();
  const project = projects.find((p) => p.id === projectId) ?? null;
  return (
    <CurrentProjectContext.Provider value={project}>{children}</CurrentProjectContext.Provider>
  );
}
