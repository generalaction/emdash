import React from 'react';
import ChatInterface from '../ChatInterface';
import ZenflowSidebar from './ZenflowSidebar';
import { useZenflowWorkflow } from '../../hooks/useZenflowWorkflow';
import type { Agent } from '../../types';
import type { Task } from '../../types/app';

interface ZenflowChatLayoutProps {
  task: Task;
  projectName: string;
  projectPath?: string | null;
  projectRemoteConnectionId?: string | null;
  projectRemotePath?: string | null;
  defaultBranch?: string | null;
  initialAgent?: Agent;
  onTaskInterfaceReady?: () => void;
}

/**
 * Wraps ChatInterface with the ZenflowSidebar.
 * Calls useZenflowWorkflow once and shares the data with both components.
 */
const ZenflowChatLayout: React.FC<ZenflowChatLayoutProps> = ({
  task,
  projectName,
  projectPath,
  projectRemoteConnectionId,
  projectRemotePath,
  defaultBranch,
  initialAgent,
  onTaskInterfaceReady,
}) => {
  const zenflow = useZenflowWorkflow(task);

  const handleStepClick = (conversationId: string) => {
    window.dispatchEvent(
      new CustomEvent('zenflow:switch-to-conversation', {
        detail: { conversationId },
      })
    );
  };

  return (
    <div className="flex min-h-0 flex-1">
      {zenflow.planSteps.length > 0 && (
        <ZenflowSidebar
          steps={zenflow.planSteps}
          workflowStatus={zenflow.workflowStatus}
          autoStartSteps={zenflow.autoStartSteps}
          onAutoStartChange={zenflow.setAutoStartSteps}
          onPause={zenflow.pause}
          onResume={zenflow.resume}
          onStartStep={(stepId) => window.electronAPI.zenflowStartStep({ taskId: task.id, stepId })}
          onRetryStep={(stepId) => zenflow.retryStep(stepId)}
          onStepClick={handleStepClick}
          taskId={task.id}
          taskPath={task.path}
        />
      )}
      <ChatInterface
        task={task}
        projectName={projectName}
        projectPath={projectPath}
        projectRemoteConnectionId={projectRemoteConnectionId}
        projectRemotePath={projectRemotePath}
        defaultBranch={defaultBranch}
        className="min-h-0 flex-1"
        initialAgent={initialAgent}
        onTaskInterfaceReady={onTaskInterfaceReady}
        zenflowData={zenflow}
      />
    </div>
  );
};

export default ZenflowChatLayout;
