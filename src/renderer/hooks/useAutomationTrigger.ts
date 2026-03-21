import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useToast } from './use-toast';
import { rpc } from '../lib/rpc';
import { makePtyId } from '@shared/ptyId';
import type { Automation } from '@shared/automations/types';
import type { ProviderId } from '@shared/providers/registry';

/**
 * Global listener for automation trigger events from the main process.
 * Creates a task and starts the agent fully in the background —
 * no view switching, no navigation away from the current screen.
 */
export function useAutomationTrigger(): void {
  const { projects } = useProjectManagementContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const runAutomationInBackground = useCallback(
    async (automation: Automation) => {
      const project = projects.find((p) => p.id === automation.projectId);
      if (!project) {
        toast({
          title: 'Automation failed',
          description: `Project not found for "${automation.name}"`,
          variant: 'destructive',
        });
        return;
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const taskName = `${automation.name} — ${timeStr}`;
      const useWorktree = automation.useWorktree ?? true;

      let branch: string;
      let taskPath: string;
      let taskId: string;

      try {
        // ---------------------------------------------------------------
        // 1. Create worktree (optional) or use project path directly
        // ---------------------------------------------------------------
        if (useWorktree) {
          const worktreeResult = await window.electronAPI.worktreeCreate({
            projectPath: project.path,
            taskName,
            projectId: project.id,
          });
          if (!worktreeResult?.success || !worktreeResult.worktree) {
            throw new Error(worktreeResult?.error || 'Failed to create worktree');
          }
          branch = worktreeResult.worktree.branch;
          taskPath = worktreeResult.worktree.path;
          taskId = worktreeResult.worktree.id;
        } else {
          branch = project.gitInfo?.branch || 'main';
          taskPath = project.path;
          taskId = `auto-${automation.id}-${Date.now()}`;
        }

        // ---------------------------------------------------------------
        // 2. Save the task to the database
        // ---------------------------------------------------------------
        await rpc.db.saveTask({
          id: taskId,
          projectId: project.id,
          name: taskName,
          branch,
          path: taskPath,
          status: 'idle',
          agentId: automation.agentId,
          metadata: {
            initialPrompt: automation.prompt,
            autoApprove: true,
            nameGenerated: true,
            automationId: automation.id,
          },
          useWorktree,
        });

        // Invalidate task cache so the sidebar picks it up
        void queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });

        // ---------------------------------------------------------------
        // 3. Start the agent PTY in the background
        // ---------------------------------------------------------------
        const ptyId = makePtyId(automation.agentId as ProviderId, 'main', taskId);
        await window.electronAPI.ptyStartDirect({
          id: ptyId,
          providerId: automation.agentId,
          cwd: taskPath,
          autoApprove: true,
          initialPrompt: automation.prompt,
        });

        toast({
          title: 'Automation running',
          description: `"${automation.name}" started in ${project.name}`,
        });
      } catch (err) {
        toast({
          title: 'Automation failed',
          description: err instanceof Error ? err.message : 'Failed to start automation',
          variant: 'destructive',
        });
      }
    },
    [projects, toast, queryClient]
  );

  useEffect(() => {
    const unsub = window.electronAPI.onAutomationTrigger((automation) => {
      void runAutomationInBackground(automation);
    });
    return unsub;
  }, [runAutomationInBackground]);
}
