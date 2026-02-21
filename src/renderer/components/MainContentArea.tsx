import React from 'react';
import ChatInterface from './ChatInterface';
import KanbanBoard from './kanban/KanbanBoard';
import MultiAgentTask from './MultiAgentTask';
import ProjectMainView from './ProjectMainView';
import HomeView from './HomeView';
import SkillsView from './skills/SkillsView';
import SettingsPage from './SettingsPage';
import TaskCreationLoading from './TaskCreationLoading';
import type { Agent } from '../types';
import type { Project, Task } from '../types/app';
import type { SettingsPageTab } from '../hooks/useModalState';

interface MainContentAreaProps {
  selectedProject: Project | null;
  activeTask: Task | null;
  activeTaskAgent: Agent | null;
  isCreatingTask: boolean;
  onTaskInterfaceReady: () => void;
  showKanban: boolean;
  showHomeView: boolean;
  showSkillsView: boolean;
  showSettingsPage: boolean;
  settingsPageInitialTab?: SettingsPageTab;
  handleCloseSettingsPage?: () => void;
  projectDefaultBranch: string;
  projectBranchOptions: Array<{ value: string; label: string }>;
  isLoadingBranches: boolean;
  setProjectDefaultBranch: (branch: string) => void;
  handleSelectTask: (task: Task) => void;
  handleDeleteTask: (
    project: Project,
    task: Task,
    options?: { silent?: boolean }
  ) => Promise<boolean>;
  handleArchiveTask: (
    project: Project,
    task: Task,
    options?: { silent?: boolean }
  ) => Promise<boolean>;
  handleDeleteProject: (project: Project) => Promise<void>;
  handleOpenProject: () => void;
  handleNewProjectClick: () => void;
  handleCloneProjectClick: () => void;
  handleAddRemoteProject: () => void;
  setShowTaskModal: (show: boolean) => void;
  setShowKanban: (show: boolean) => void;
  projectRemoteConnectionId?: string | null;
  projectRemotePath?: string | null;
}

const MainContentArea: React.FC<MainContentAreaProps> = ({
  selectedProject,
  activeTask,
  activeTaskAgent,
  isCreatingTask,
  onTaskInterfaceReady,
  showKanban,
  showHomeView,
  showSkillsView,
  showSettingsPage,
  settingsPageInitialTab,
  handleCloseSettingsPage,
  projectDefaultBranch,
  projectBranchOptions,
  isLoadingBranches,
  setProjectDefaultBranch,
  handleSelectTask,
  handleDeleteTask,
  handleArchiveTask,
  handleDeleteProject,
  handleOpenProject,
  handleNewProjectClick,
  handleCloneProjectClick,
  handleAddRemoteProject,
  setShowTaskModal,
  setShowKanban,
  projectRemoteConnectionId,
  projectRemotePath,
}) => {
  if (showSettingsPage) {
    return (
      <div className="relative z-40 flex min-h-0 flex-1 overflow-hidden bg-background">
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
          onCreateTask={() => setShowTaskModal(true)}
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
              projectName={selectedProject.name}
              projectPath={selectedProject.path}
              projectRemoteConnectionId={projectRemoteConnectionId}
              projectRemotePath={projectRemotePath}
              defaultBranch={projectDefaultBranch}
              className="min-h-0 flex-1"
              initialAgent={activeTaskAgent || undefined}
              onTaskInterfaceReady={onTaskInterfaceReady}
            />
          )
        ) : (
          <ProjectMainView
            project={selectedProject}
            onCreateTask={() => setShowTaskModal(true)}
            activeTask={activeTask}
            onSelectTask={handleSelectTask}
            onDeleteTask={handleDeleteTask}
            onArchiveTask={handleArchiveTask}
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
