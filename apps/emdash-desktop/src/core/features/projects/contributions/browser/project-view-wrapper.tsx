import type { ReactNode } from 'react';
import { ProjectSshHealthGate } from '@core/features/projects/browser/components/project-ssh-health-gate';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { SubjectProvider } from '@core/primitives/mementos/react';

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
