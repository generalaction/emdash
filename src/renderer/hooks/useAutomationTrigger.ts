import { useEffect, useCallback, useRef } from 'react';
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
import { isValidProviderId } from '@shared/providers/registry';

/**
 * Global listener for automation trigger events from the main process.
 * Creates a task and starts the agent fully in the background —
 * no view switching, no navigation away from the current screen.
 *
 * Uses a pull-based model: the main process queues triggers and
 * sends a hint event. This hook drains the queue when ready, avoiding
 * lost triggers from startup races or React mount timing.
 */
export function useAutomationTrigger(enabled = true): void {
  const { projects, isInitialLoadComplete } = useProjectManagementContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Track PTY exit unsubscribers so we can clean them up on unmount
  const ptyExitUnsubs = useRef<Map<string, () => void>>(new Map());

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
        void window.electronAPI.automationsCompleteRun({
          runLogId,
          automationId: automation.id,
          status: 'failure',
          error: errorMsg,
        });
        return;
      }

      setAutomationRunPhase(automation.id, automation.name, 'preparing');

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const taskName = `${automation.name} — ${timeStr}`;
      const useWorktree = automation.useWorktree ?? true;

      let branch = '';
      let taskPath = '';
      let taskId = '';
      let worktreeCreated = false;

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
          worktreeCreated = true;
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

        void queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });

        // ---------------------------------------------------------------
        // 3. Start the agent PTY in the background
        // ---------------------------------------------------------------
        setAutomationRunPhase(automation.id, automation.name, 'starting-agent');

        if (!isValidProviderId(automation.agentId)) {
          throw new Error(
            `Unknown provider "${automation.agentId}" for automation "${automation.name}"`
          );
        }

        const ptyId = makePtyId(automation.agentId, 'main', taskId);
        const ptyResult = await window.electronAPI.ptyStartDirect({
          id: ptyId,
          providerId: automation.agentId,
          cwd: taskPath,
          autoApprove: true,
          initialPrompt: automation.prompt,
          remote:
            project.isRemote && project.sshConnectionId
              ? { connectionId: project.sshConnectionId }
              : undefined,
        });

        // Check PTY start result — fail explicitly if it didn't start
        if (ptyResult && !ptyResult.ok) {
          throw new Error(ptyResult.error || 'PTY failed to start');
        }

        // Listen for PTY exit to report the real outcome back to main.
        // Track the unsubscriber so we can clean up on unmount
        const unsubExit = window.electronAPI.onPtyExit(ptyId, ({ exitCode }) => {
          ptyExitUnsubs.current.delete(ptyId);
          unsubExit();
          void window.electronAPI.automationsCompleteRun({
            runLogId,
            automationId: automation.id,
            taskId,
            status: exitCode === 0 ? 'success' : 'failure',
            error: exitCode !== 0 ? `Agent exited with code ${exitCode}` : undefined,
          });
        });
        ptyExitUnsubs.current.set(ptyId, unsubExit);

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
        void window.electronAPI.automationsCompleteRun({
          runLogId,
          automationId: automation.id,
          status: 'failure',
          error: errorMessage,
        });

        // Clean up the worktree if we created one before the error
        if (worktreeCreated && taskId && taskPath) {
          try {
            await window.electronAPI.worktreeRemove({
              projectPath: project.path,
              worktreeId: taskId,
              worktreePath: taskPath,
            });
          } catch {
            // Best-effort cleanup — don't mask the original error
          }
        }
      }
    },
    [projects, toast, queryClient]
  );

  // Drain queued triggers from the main process
  const drainTriggers = useCallback(async () => {
    try {
      const result = await window.electronAPI.automationsDrainTriggers();
      if (result.success && result.data) {
        for (const automation of result.data) {
          void runAutomationInBackground(automation);
        }
      }
    } catch (err) {
      console.error('[Automations] Failed to drain triggers:', err);
    }
  }, [runAutomationInBackground]);

  useEffect(() => {
    if (!enabled) return;
    // Don't drain triggers until projects are loaded — otherwise we'll get
    // "Project not found" errors because the projects array is still empty.
    // The triggers stay safely queued in the main process until we're ready.
    if (!isInitialLoadComplete) return;

    // Listen for hint events from main process (new triggers available)
    const unsub = window.electronAPI.onAutomationTriggerAvailable(() => {
      void drainTriggers();
    });

    // Drain on mount — pick up anything queued before we were ready
    void drainTriggers();

    return () => {
      unsub();
      // Clean up any outstanding PTY exit listeners on unmount
      for (const unsubFn of ptyExitUnsubs.current.values()) {
        unsubFn();
      }
      ptyExitUnsubs.current.clear();
    };
  }, [drainTriggers, enabled, isInitialLoadComplete]);
}
