import { Titlebar } from '@/components/titlebar/Titlebar';
import HomeView from '@/components/HomeView';
import { useProjectManagementContext } from '@/contexts/ProjectManagementProvider';
import { useWorkspaceNavigation } from '@/contexts/WorkspaceNavigationContext';

export function HomeTitlebar() {
  return <Titlebar />;
}

export function HomeMainPanel() {
  const {
    handleOpenProject,
    handleNewProjectClick,
    handleCloneProjectClick,
    handleAddRemoteProject,
  } = useProjectManagementContext();

  return (
    <HomeView
      onOpenProject={handleOpenProject}
      onNewProjectClick={handleNewProjectClick}
      onCloneProjectClick={handleCloneProjectClick}
      onAddRemoteProject={handleAddRemoteProject}
    />
  );
}
