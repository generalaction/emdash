import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useToast } from './use-toast';
import { rpc } from '../lib/rpc';
import { makePtyId } from '@shared/ptyId';
import { isValidProviderId } from '@shared/providers/registry';

const DEFAULT_AGENT_ID = 'claude';

interface McpTaskRequest {
  id: string;
  projectId: string;
  prompt: string;
  taskName?: string;
  agentId?: string;
}

/**
 * Global listener for MCP task requests from the main process.
 * Creates a task and starts the agent fully in the background —
 * no view switching, no navigation away from the current screen.
 *
 * Uses a pull-based model: the main process queues requests and
 * sends a hint event. This hook drains the queue when ready.
 */
export function useMcpTaskTrigger(): void {
  const { projects, isInitialLoadComplete } = useProjectManagementContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const ptyExitUnsubs = useRef<Map<string, () => void>>(new Map());

  const runMcpTaskInBackground = useCallback(
    async (request: McpTaskRequest) => {
      const project = projects.find((p) => p.id === request.projectId);
      if (!project) {
        toast({
          title: 'MCP task failed',
          description: `Project not found: ${request.projectId}`,
          variant: 'destructive',
        });
        return;
      }

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const taskName = request.taskName || `MCP task — ${timeStr}`;
      const agentId = isValidProviderId(request.agentId) ? request.agentId : DEFAULT_AGENT_ID;

      let taskId = '';
      let taskPath = '';
      let branch = '';
      let worktreeCreated = false;
      let taskSaved = false;

      try {
        // ---------------------------------------------------------------
        // 1. Create worktree
        // ---------------------------------------------------------------
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
          agentId,
          metadata: {
            initialPrompt: request.prompt,
            autoApprove: true,
            nameGenerated: !request.taskName,
          },
          useWorktree: true,
        });

        taskSaved = true;
        void queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });

        // ---------------------------------------------------------------
        // 3. Start the agent PTY in the background
        // ---------------------------------------------------------------
        const ptyId = makePtyId(agentId, 'main', taskId);
        const ptyResult = await window.electronAPI.ptyStartDirect({
          id: ptyId,
          providerId: agentId,
          cwd: taskPath,
          autoApprove: true,
          initialPrompt: request.prompt,
          remote:
            project.isRemote && project.sshConnectionId
              ? { connectionId: project.sshConnectionId }
              : undefined,
        });

        if (ptyResult && !ptyResult.ok) {
          throw new Error(ptyResult.error || 'PTY failed to start');
        }

        const unsubExit = window.electronAPI.onPtyExit(ptyId, () => {
          ptyExitUnsubs.current.delete(ptyId);
          unsubExit();
        });
        ptyExitUnsubs.current.set(ptyId, unsubExit);

        toast({
          title: 'MCP task started',
          description: `"${taskName}" started in ${project.name}`,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to start MCP task';
        toast({
          title: 'MCP task failed',
          description: errorMessage,
          variant: 'destructive',
        });

        // Best-effort rollback: remove the saved task and its worktree
        if (taskSaved && taskId) {
          try {
            await rpc.db.deleteTask(taskId);
            void queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });
          } catch {
            // ignore
          }
        }
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

  const drainTasks = useCallback(async () => {
    try {
      const result = await window.electronAPI.mcpDrainTaskQueue();
      if (result.success && result.data) {
        for (const task of result.data) {
          void runMcpTaskInBackground(task);
        }
      }
    } catch (err) {
      console.error('[MCP] Failed to drain task queue:', err);
    }
  }, [runMcpTaskInBackground]);

  useEffect(() => {
    if (!isInitialLoadComplete) return;

    const unsub = window.electronAPI.onMcpTaskAvailable(() => {
      void drainTasks();
    });

    // Drain on mount — pick up anything queued before we were ready
    void drainTasks();

    return () => {
      unsub();
      for (const unsubFn of ptyExitUnsubs.current.values()) {
        unsubFn();
      }
      ptyExitUnsubs.current.clear();
    };
  }, [drainTasks, isInitialLoadComplete]);
}
