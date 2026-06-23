import type { ReactNode } from 'react';
import { ProjectSshHealthGate } from './project-ssh-health-gate';

interface ProjectViewWrapperProps {
  children: ReactNode;
  projectId: string;
}

export function ProjectViewWrapper({ children, projectId }: ProjectViewWrapperProps) {
  return <ProjectSshHealthGate projectId={projectId}>{children}</ProjectSshHealthGate>;
}
