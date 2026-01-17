import React from 'react';
import type { Provider } from '../types';
import type { Project, Task } from '../types/app';
import ChatInterface from './ChatInterface';
import { HomeView } from './HomeView';
import KanbanBoard from './kanban/KanbanBoard';
import MultiAgentTask from './MultiAgentTask';
import ProjectMainView from './ProjectMainView';

/**
 * Main content area component that switches between different views
 * Extracted from App.tsx to reduce complexity
 */

export interface MainContentAreaProps {
  // View state
  showHomeView: boolean;
  showKanban: boolean;
  selectedProject: Project | null;
  activeTask: Task | null;
  activeTaskProvider: Provider | null;

  // Project branch state
  projectBranchOptions: Array<{ value: string; label: string }>;
  isLoadingBranches: boolean;
  projectDefaultBranch: string;

  // Loading states
  isCreatingTask: boolean;

  // Event handlers
  onOpenProject: () => void;
  onNewProject: () => void;
  onCloneProject: () => void;
  onCreateTask: () => void;
  onSelectTask: (task: Task) => void;
  onDeleteTask: (project: Project, task: Task, options?: { silent?: boolean }) => Promise<boolean>;
  onDeleteProject: (project: Project) => Promise<void>;
  onBaseBranchChange: (branch: string) => void;
  onCloseKanban: () => void;
}

export const MainContentArea: React.FC<MainContentAreaProps> = ({
  showHomeView,
  showKanban,
  selectedProject,
  activeTask,
  activeTaskProvider,
  projectBranchOptions,
  isLoadingBranches,
  projectDefaultBranch,
  isCreatingTask,
  onOpenProject,
  onNewProject,
  onCloneProject,
  onCreateTask,
  onSelectTask,
  onDeleteTask,
  onDeleteProject,
  onBaseBranchChange,
  onCloseKanban,
}) => {
  // Kanban view
  if (selectedProject && showKanban) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <KanbanBoard
          project={selectedProject}
          onOpenTask={(task: any) => {
            onSelectTask(task);
            onCloseKanban();
          }}
          onCreateTask={onCreateTask}
        />
      </div>
    );
  }

  // Home view
  if (showHomeView) {
    return (
      <HomeView
        onOpenProject={onOpenProject}
        onNewProject={onNewProject}
        onCloneProject={onCloneProject}
      />
    );
  }

  // Project view
  if (selectedProject) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTask ? (
          // Active task view
          (activeTask.metadata as any)?.multiAgent?.enabled ? (
            // Multi-agent task
            <MultiAgentTask
              task={activeTask}
              projectName={selectedProject.name}
              projectId={selectedProject.id}
            />
          ) : (
            // Single-agent task with chat interface
            <ChatInterface
              task={activeTask}
              projectName={selectedProject.name}
              className="min-h-0 flex-1"
              initialProvider={activeTaskProvider || undefined}
            />
          )
        ) : (
          // Project main view (no active task)
          <ProjectMainView
            project={selectedProject}
            onCreateTask={onCreateTask}
            activeTask={activeTask}
            onSelectTask={onSelectTask}
            onDeleteTask={onDeleteTask}
            isCreatingTask={isCreatingTask}
            onDeleteProject={onDeleteProject}
            branchOptions={projectBranchOptions}
            isLoadingBranches={isLoadingBranches}
            onBaseBranchChange={onBaseBranchChange}
          />
        )}
      </div>
    );
  }

  // Fallback (shouldn't happen)
  return null;
};