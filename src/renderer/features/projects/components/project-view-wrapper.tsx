import type { ReactNode } from 'react';
import { RepositoryProvider } from '../repository-provider';

interface ProjectViewWrapperProps {
  children: ReactNode;
  projectId: string;
}

export function ProjectViewWrapper({ children, projectId }: ProjectViewWrapperProps) {
  return <RepositoryProvider projectId={projectId}>{children}</RepositoryProvider>;
}
