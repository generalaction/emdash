import React from 'react';
import { type Agent } from '../types';
import { Task } from '../types/chat';
import type { Project } from '../types/app';
import { TaskScopeProvider } from './TaskScopeContext';
import { ChatViewProvider } from '../contexts/ChatViewProvider';
import { ChatTabs } from './ChatTabs';
import { ChatContent } from './ChatContent';
import { useTheme } from '../hooks/useTheme';

interface Props {
  task: Task;
  project?: Project | null;
  projectPath?: string | null;
  projectRemoteConnectionId?: string | null;
  defaultBranch?: string | null;
  className?: string;
  initialAgent?: Agent;
  onTaskInterfaceReady?: () => void;
  onRenameTask?: (project: Project, task: Task, newName: string) => Promise<void>;
  /** @deprecated kept for call-site compatibility */
  projectName?: string;
  /** @deprecated kept for call-site compatibility */
  projectRemotePath?: string | null;
}

const ChatInterface: React.FC<Props> = ({
  task,
  project,
  projectPath,
  projectRemoteConnectionId,
  defaultBranch,
  className,
  initialAgent,
  onTaskInterfaceReady,
  onRenameTask,
  projectName: _projectName,
  projectRemotePath: _projectRemotePath,
}) => {
  const { effectiveTheme } = useTheme();

  return (
    <TaskScopeProvider value={{ taskId: task.id, taskPath: task.path }}>
      <ChatViewProvider
        task={task}
        project={project}
        projectPath={projectPath}
        projectRemoteConnectionId={projectRemoteConnectionId}
        defaultBranch={defaultBranch}
        initialAgent={initialAgent}
        onTaskInterfaceReady={onTaskInterfaceReady}
        onRenameTask={onRenameTask}
      >
        <div
          className={`flex h-full flex-col ${effectiveTheme === 'dark-black' ? 'bg-black' : 'bg-card'} ${className ?? ''}`}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-6 pt-4">
              <div className="mx-auto max-w-4xl space-y-2">
                <ChatTabs />
              </div>
            </div>
            <div className="mt-4 min-h-0 flex-1 px-6">
              <ChatContent />
            </div>
          </div>
        </div>
      </ChatViewProvider>
    </TaskScopeProvider>
  );
};

export default ChatInterface;
