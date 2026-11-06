import { observer } from 'mobx-react-lite';
import { useEffect, type ReactNode } from 'react';
import { getProjectViewStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { SubjectProvider } from '@core/primitives/mementos/react';

interface ProjectViewWrapperProps {
  children: ReactNode;
  projectId: string;
}

export const ProjectViewWrapper = observer(function ProjectViewWrapper({
  children,
  projectId,
}: ProjectViewWrapperProps) {
  const view = getProjectViewStore(projectId);
  const { value: settings, isLoading } = useAppSettingsKey('interface');
  const boardByDefault = settings?.boardByDefault ?? false;
  useEffect(() => {
    if (!isLoading) view?.applyDefaultTaskView(boardByDefault);
  }, [projectId, view, isLoading, boardByDefault]);

  return <SubjectProvider subject={projectSubject({ projectId })}>{children}</SubjectProvider>;
});
