import { projectSubject } from '@core/features/projects/contributions/subject';
import { SubjectProvider } from '@core/primitives/mementos/react';
import type { ReactNode } from 'react';
import { ProjectSshHealthGate } from './project-ssh-health-gate';

interface ProjectViewWrapperProps {
  children: ReactNode;
  projectId: string;
}

export function ProjectViewWrapper({ children, projectId }: ProjectViewWrapperProps) {
  return (
    <SubjectProvider subject={projectSubject({ projectId })}>
      <ProjectSshHealthGate projectId={projectId}>{children}</ProjectSshHealthGate>
    </SubjectProvider>
  );
}
