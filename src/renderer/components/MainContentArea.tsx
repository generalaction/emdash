import React from 'react';
import ChatInterface from './ChatInterface';
import KanbanBoard from './kanban/KanbanBoard';
import MultiAgentTask from './MultiAgentTask';
import ProjectMainView from './ProjectMainView';
import HomeView from './HomeView';
import SkillsView from './skills/SkillsView';
import { SettingsPage, type SettingsPageTab } from './SettingsPage';
import TaskCreationLoading from './TaskCreationLoading';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../contexts/TaskManagementContext';
import { useProjectRemoteInfo } from '../hooks/useProjectRemoteInfo';

interface MainContentAreaProps {
  showSettingsPage: boolean;
  settingsPageInitialTab?: SettingsPageTab;
  handleCloseSettingsPage?: () => void;
}

const MainContentArea: React.FC<MainContentAreaProps> = ({
  showSettingsPage,
  settingsPageInitialTab,
  handleCloseSettingsPage,
}) => {
  const { connectionId: projectRemoteConnectionId, remotePath: projectRemotePath } =
    useProjectRemoteInfo();
  const {
    selectedProject,
    showHomeView,
    showSkillsView,
    showKanban,
    setShowKanban,
    projectDefaultBranch,
    projectBranchOptions,
    isLoadingBranches,
    setProjectDefaultBranch,
    handleDeleteProject,
    handleOpenProject,
    handleNewProjectClick,
    handleCloneProjectClick,
    handleAddRemoteProject,
  } = useProjectManagementContext();
  const {
    activeTask,
    activeTaskAgent,
    isCreatingTask,
    handleTaskInterfaceReady: onTaskInterfaceReady,
    openTaskModal,
    handleSelectTask,
    handleDeleteTask,
    handleArchiveTask,
    handleRestoreTask,
    handleRenameTask: onRenameTask,
  } = useTaskManagementContext();
  if (showSettingsPage) {
    return (
      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
        <SettingsPage
          initialTab={settingsPageInitialTab}
          onClose={handleCloseSettingsPage || (() => {})}
        />
      </div>
    );
  }

  if (selectedProject && showKanban) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <KanbanBoard
          project={selectedProject}
          onOpenTask={(ws: any) => {
            handleSelectTask(ws);
            setShowKanban(false);
          }}
          onCreateTask={() => openTaskModal()}
        />
      </div>
    );
  }

  if (showSkillsView) {
    return <SkillsView />;
  }

  if (showHomeView) {
    return (
      <HomeView
        onOpenProject={handleOpenProject}
        onNewProjectClick={handleNewProjectClick}
        onCloneProjectClick={handleCloneProjectClick}
        onAddRemoteProject={handleAddRemoteProject}
      />
    );
  }

  if (selectedProject) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTask ? (
          (activeTask.metadata as any)?.multiAgent?.enabled ? (
            <MultiAgentTask
              task={activeTask}
              projectName={selectedProject.name}
              projectId={selectedProject.id}
              projectPath={selectedProject.path}
              projectRemoteConnectionId={projectRemoteConnectionId}
              projectRemotePath={projectRemotePath}
              defaultBranch={projectDefaultBranch}
              onTaskInterfaceReady={onTaskInterfaceReady}
            />
          ) : (
            <ChatInterface
              task={activeTask}
              project={selectedProject}
              projectName={selectedProject.name}
              projectPath={selectedProject.path}
              projectRemoteConnectionId={projectRemoteConnectionId}
              projectRemotePath={projectRemotePath}
              defaultBranch={projectDefaultBranch}
              className="min-h-0 flex-1"
              initialAgent={activeTaskAgent || undefined}
              onTaskInterfaceReady={onTaskInterfaceReady}
              onRenameTask={onRenameTask}
            />
          )
        ) : (
          <ProjectMainView
            project={selectedProject}
            onCreateTask={() => openTaskModal()}
            activeTask={activeTask}
            onSelectTask={handleSelectTask}
            onDeleteTask={handleDeleteTask}
            onArchiveTask={handleArchiveTask}
            onRestoreTask={handleRestoreTask}
            onDeleteProject={handleDeleteProject}
            branchOptions={projectBranchOptions}
            isLoadingBranches={isLoadingBranches}
            onBaseBranchChange={setProjectDefaultBranch}
          />
        )}

        {isCreatingTask && (
          <div className="absolute inset-0 z-10 bg-background">
            <TaskCreationLoading />
          </div>
        )}
      </div>
    );
  }

  return null;
};

export default MainContentArea;
