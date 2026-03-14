import HomeView from '@renderer/components/HomeView';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { useProjectManagementContext } from '@renderer/contexts/ProjectsProvider';

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
