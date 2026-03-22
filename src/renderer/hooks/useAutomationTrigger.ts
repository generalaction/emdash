import { useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useToast } from './use-toast';
import { rpc } from '../lib/rpc';
import { makePtyId } from '@shared/ptyId';
import {
  setAutomationRunPhase,
  clearAutomationRun,
} from '../components/automations/useRunningAutomations';
import type { Automation } from '@shared/automations/types';
import type { ProviderId } from '@shared/providers/registry';

/**
 * Global listener for automation trigger events from the main process.
 * Creates a task and starts the agent fully in the background —
 * no view switching, no navigation away from the current screen.
 *
 * Tracks the run log ID so the main process can update run logs
 * when the agent finishes (success/failure).
 */
export function useAutomationTrigger(): void {
  const { projects } = useProjectManagementContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const runAutomationInBackground = useCallback(
    async (automation: Automation & { _runLogId: string }) => {
      const runLogId = automation._runLogId;
      const project = projects.find((p) => p.id === automation.projectId);
      if (!project) {
        const errorMsg = `Project not found for "${automation.name}"`;
        toast({
          title: 'Automation failed',
          description: errorMsg,
          variant: 'destructive',
        });
        setAutomationRunPhase(automation.id, automation.name, 'error', {
          error: 'Project not found',
        });
        // Report failure back to main
        void window.electronAPI.automationsCompleteRun({
          runLogId,
          automationId: automation.id,
          status: 'failure',
          error: errorMsg,
        });
        return;
      }

      // Phase 1: Preparing
      setAutomationRunPhase(automation.id, automation.name, 'preparing');

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
          setAutomationRunPhase(automation.id, automation.name, 'creating-worktree');

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
        setAutomationRunPhase(automation.id, automation.name, 'saving-task');

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
        setAutomationRunPhase(automation.id, automation.name, 'starting-agent');

        const ptyId = makePtyId(automation.agentId as ProviderId, 'main', taskId);
        await window.electronAPI.ptyStartDirect({
          id: ptyId,
          providerId: automation.agentId,
          cwd: taskPath,
          autoApprove: true,
          initialPrompt: automation.prompt,
        });

        // Listen for PTY exit to report the real outcome back to main.
        const unsubExit = window.electronAPI.onPtyExit(ptyId, ({ exitCode }) => {
          unsubExit();
          void window.electronAPI.automationsCompleteRun({
            runLogId,
            automationId: automation.id,
            taskId,
            status: exitCode === 0 ? 'success' : 'failure',
            error: exitCode !== 0 ? `Agent exited with code ${exitCode}` : undefined,
          });
        });

        // Clear the brief triggering-phase indicator now that the PTY is up.
        clearAutomationRun(automation.id);

        toast({
          title: 'Automation running',
          description: `"${automation.name}" started in ${project.name}`,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to start automation';
        setAutomationRunPhase(automation.id, automation.name, 'error', {
          error: errorMessage,
        });
        toast({
          title: 'Automation failed',
          description: errorMessage,
          variant: 'destructive',
        });
        // Report failure back to main
        void window.electronAPI.automationsCompleteRun({
          runLogId,
          automationId: automation.id,
          status: 'failure',
          error: errorMessage,
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
