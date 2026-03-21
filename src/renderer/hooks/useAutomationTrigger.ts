import { useEffect, useCallback } from 'react';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useTaskManagementContext } from '../contexts/TaskManagementContext';
import { useToast } from './use-toast';
import type { Automation } from '@shared/automations/types';
import type { Agent } from '../types';

/**
 * Global listener for automation trigger events from the main process.
 * Creates a new task in the target project when an automation fires.
 * Must be mounted inside both ProjectManagement and TaskManagement providers.
 */
export function useAutomationTrigger(): void {
  const { projects, activateProjectView } = useProjectManagementContext();
  const { handleCreateTask } = useTaskManagementContext();
  const { toast } = useToast();

  const createTaskFromAutomation = useCallback(
    async (automation: Automation) => {
      const project = projects.find((p) => p.id === automation.projectId);
      if (!project) {
        toast({
          title: 'Automation failed',
          description: `Project not found for automation "${automation.name}"`,
          variant: 'destructive',
        });
        return;
      }

      // Activate the project so the task appears in the sidebar
      activateProjectView(project);

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const taskName = `${automation.name} — ${timeStr}`;

      try {
        await handleCreateTask(
          taskName,
          automation.prompt,
          [{ agent: automation.agentId as Agent, runs: 1 }],
          null, // linkedLinearIssue
          null, // linkedGithubIssue
          null, // linkedJiraIssue
          null, // linkedPlainThread
          null, // linkedGitlabIssue
          null, // linkedForgejoIssue
          true, // autoApprove
          true, // useWorktree
          undefined, // baseRef
          true, // nameGenerated
          false, // useRemoteWorkspace
          undefined, // workspaceProvider
          project // overrideProject
        );

        toast({
          title: 'Automation triggered',
          description: `Created task "${taskName}" in ${project.name}`,
        });
      } catch (err) {
        toast({
          title: 'Automation failed',
          description: err instanceof Error ? err.message : 'Failed to create task',
          variant: 'destructive',
        });
      }
    },
    [projects, activateProjectView, handleCreateTask, toast]
  );

  useEffect(() => {
    const unsub = window.electronAPI.onAutomationTrigger((automation) => {
      void createTaskFromAutomation(automation);
    });
    return unsub;
  }, [createTaskFromAutomation]);
}
