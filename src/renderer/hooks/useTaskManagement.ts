import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { TERMINAL_PROVIDER_IDS } from '../constants/agents';
import { disposeTaskTerminals } from '../lib/taskTerminalsStore';
import type { Project, Task } from '../types/app';
import type { GitHubIssueLink, AgentRun } from '../types/chat';
import type { LinearIssueSummary } from '../types/linear';
import type { GitHubIssueSummary } from '../types/github';
import type { JiraIssueSummary } from '../types/jira';
import { rpc } from '../lib/rpc';
import { createTask } from '../lib/taskCreationService';
import { prewarmWorktreeReserve } from '../lib/worktreeUtils';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useToast } from './use-toast';
import { useModalContext } from '../contexts/ModalProvider';
import {
  useWorkspaceNavigation,
  useWorkspaceWrapParams,
} from '../contexts/WorkspaceNavigationContext';

const LIFECYCLE_TEARDOWN_TIMEOUT_MS = 15000;
type LifecycleTarget = { taskId: string; taskPath: string; label: string };

const getLifecycleTaskIds = (task: Task): string[] => {
  const ids = new Set<string>([task.id]);
  const variants = task.metadata?.multiAgent?.variants || [];
  for (const variant of variants) {
    if (variant?.worktreeId) {
      ids.add(variant.worktreeId);
    }
  }
  return [...ids];
};

const getLifecycleTargets = (task: Task): LifecycleTarget[] => {
  const variants = task.metadata?.multiAgent?.variants || [];
  if (variants.length > 0) {
    const validVariantTargets = variants
      .filter((variant) => variant?.worktreeId && variant?.path)
      .map((variant) => ({
        taskId: variant.worktreeId,
        taskPath: variant.path,
        label: variant.name || variant.worktreeId,
      }));
    if (validVariantTargets.length > 0) {
      return validVariantTargets;
    }
  }

  return [{ taskId: task.id, taskPath: task.path, label: task.name }];
};

const runSetupForTask = async (task: Task, projectPath: string): Promise<void> => {
  const targets = getLifecycleTargets(task);
  await Promise.allSettled(
    targets.map((target) =>
      rpc.lifecycle.setup({
        taskId: target.taskId,
        taskPath: target.taskPath,
        projectPath,
        taskName: target.label,
      })
    )
  );
};

const buildLinkedGithubIssueMap = (tasks?: Task[] | null): Map<number, GitHubIssueLink> => {
  const linked = new Map<number, GitHubIssueLink>();
  if (!tasks?.length) return linked;
  for (const task of tasks) {
    const issueNumber = task.metadata?.githubIssue?.number;
    if (typeof issueNumber !== 'number' || linked.has(issueNumber)) continue;
    linked.set(issueNumber, {
      number: issueNumber,
      taskId: task.id,
      taskName: task.name,
    });
  }
  return linked;
};

// Renderer-side cleanup: clears taskTerminalsStore entries.
// PTY kills and snapshot deletion are handled by the main process (ptyCleanup.ts)
// which is triggered by the deleteTask/archiveTask RPC handlers in dbIpc.ts.
const cleanupRendererResources = (task: Task): void => {
  try {
    const variantPaths = (task.metadata?.multiAgent?.variants || []).map((v: any) => v.path);
    const pathsToClean = variantPaths.length > 0 ? variantPaths : [task.path];
    for (const p of pathsToClean) {
      disposeTaskTerminals(`${task.id}::${p}`);
      if (task.useWorktree !== false) {
        disposeTaskTerminals(`global::${p}`);
      }
    }
    disposeTaskTerminals(task.id);
  } catch {}
};

export function useTaskManagement() {
  const { projects, autoOpenTaskModalTrigger } = useProjectManagementContext();
  const { navigate } = useWorkspaceNavigation();
  const { wrapParams } = useWorkspaceWrapParams();
  const currentProjectId = wrapParams.projectId as string | null;
  const currentTaskId = wrapParams.taskId as string | null;

  const { toast } = useToast();
  const { showModal } = useModalContext();
  const queryClient = useQueryClient();

  // ---------------------------------------------------------------------------
  // Task queries — one per project via useQueries
  // ---------------------------------------------------------------------------
  const taskResults = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['tasks', project.id],
      queryFn: () => rpc.db.getTasks(project.id) as Promise<Task[]>,
      enabled: !!project.id,
      staleTime: Infinity,
    })),
  });

  const tasksByProjectId = useMemo(() => {
    const map: Record<string, Task[]> = {};
    projects.forEach((p, i) => {
      map[p.id] = taskResults[i]?.data ?? [];
    });
    return map;
  }, [projects, taskResults]);

  const archivedTaskResults = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['archivedTasks', project.id],
      queryFn: () => rpc.db.getArchivedTasks(project.id) as Promise<Task[]>,
      enabled: !!project.id,
      staleTime: Infinity,
    })),
  });

  const archivedTasksByProjectId = useMemo(() => {
    const map: Record<string, Task[]> = {};
    projects.forEach((p, i) => {
      map[p.id] = archivedTaskResults[i]?.data ?? [];
    });
    return map;
  }, [projects, archivedTaskResults]);

  const allTasks = useMemo(
    () =>
      projects.flatMap((p) => (tasksByProjectId[p.id] ?? []).map((task) => ({ task, project: p }))),
    [projects, tasksByProjectId]
  );

  const linkedGithubIssueMap = useMemo(
    () => buildLinkedGithubIssueMap(currentProjectId ? tasksByProjectId[currentProjectId] : null),
    [currentProjectId, tasksByProjectId]
  );

  // ---------------------------------------------------------------------------
  // Local UI state
  // ---------------------------------------------------------------------------
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const deletingTaskIdsRef = useRef<Set<string>>(new Set());
  const restoringTaskIdsRef = useRef<Set<string>>(new Set());
  const archivingTaskIdsRef = useRef<Set<string>>(new Set());
  const openTaskModalImplRef = useRef<() => void>(() => {});
  const openTaskModal = useCallback(() => openTaskModalImplRef.current(), []);

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------
  const updateTaskCache = useCallback(
    (projectId: string, updater: (old: Task[]) => Task[]) => {
      queryClient.setQueryData<Task[]>(['tasks', projectId], (old = []) => updater(old));
    },
    [queryClient]
  );

  const removeTaskFromCache = useCallback(
    (projectId: string, taskId: string, wasActive: boolean) => {
      updateTaskCache(projectId, (old) => old.filter((t) => t.id !== taskId));
      if (wasActive) {
        navigate('project', { projectId });
      }
    },
    [updateTaskCache, navigate]
  );

  // ---------------------------------------------------------------------------
  // Lifecycle helpers
  // ---------------------------------------------------------------------------
  const runLifecycleTeardownBestEffort = async (
    targetProject: Project,
    task: Task,
    action: 'archive' | 'delete',
    options?: { silent?: boolean }
  ): Promise<void> => {
    const continueLabel = action === 'archive' ? 'archiving' : 'deletion';
    const lifecycleTargets = getLifecycleTargets(task);
    const issues: string[] = [];

    await Promise.allSettled(
      lifecycleTargets.map((target) => rpc.lifecycle.runStop({ taskId: target.taskId }))
    );

    for (const target of lifecycleTargets) {
      try {
        const teardownPromise = rpc.lifecycle.teardown({
          taskId: target.taskId,
          taskPath: target.taskPath,
          projectPath: targetProject.path,
          taskName: target.label,
        });
        const timeoutPromise = new Promise<'timeout'>((resolve) => {
          window.setTimeout(() => resolve('timeout'), LIFECYCLE_TEARDOWN_TIMEOUT_MS);
        });
        const result = await Promise.race([teardownPromise, timeoutPromise]);

        if (result === 'timeout') {
          issues.push(`${target.label}: timeout`);
          continue;
        }
        if (!result?.success && !(result as { skipped?: boolean })?.skipped) {
          issues.push(`${target.label}: ${result?.error || 'teardown script failed'}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        issues.push(`${target.label}: ${message}`);
      }
    }

    if (issues.length > 0) {
      const { log } = await import('../lib/logger');
      log.warn(
        `Lifecycle teardown issues for "${task.name}"; continuing ${continueLabel}.`,
        issues.join(' | ')
      );
      if (!options?.silent) {
        toast({
          title: 'Teardown issues',
          description: `Continuing ${continueLabel} (${issues.length} issue${issues.length === 1 ? '' : 's'}).`,
        });
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Navigation helpers
  // ---------------------------------------------------------------------------
  const handleSelectTask = useCallback(
    (task: Task) => {
      navigate('task', { projectId: task.projectId, taskId: task.id });
      const taskProject = projects.find((p) => p.id === task.projectId);
      if (taskProject) {
        prewarmWorktreeReserve(
          taskProject.id,
          taskProject.path,
          taskProject.gitInfo?.isGitRepo,
          taskProject.gitInfo?.baseRef || 'HEAD'
        );
      }
    },
    [navigate, projects]
  );

  const handleNextTask = useCallback(() => {
    if (allTasks.length === 0) return;
    const currentIndex = currentTaskId
      ? allTasks.findIndex((t: { task: Task; project: Project }) => t.task.id === currentTaskId)
      : -1;
    const nextIndex = (currentIndex + 1) % allTasks.length;
    const { task, project } = allTasks[nextIndex];
    navigate('task', { projectId: project.id, taskId: task.id });
  }, [allTasks, currentTaskId, navigate]);

  const handlePrevTask = useCallback(() => {
    if (allTasks.length === 0) return;
    const currentIndex = currentTaskId
      ? allTasks.findIndex((t: { task: Task; project: Project }) => t.task.id === currentTaskId)
      : -1;
    const prevIndex = currentIndex <= 0 ? allTasks.length - 1 : currentIndex - 1;
    const { task, project } = allTasks[prevIndex];
    navigate('task', { projectId: project.id, taskId: task.id });
  }, [allTasks, currentTaskId, navigate]);

  const handleNewTask = useCallback(() => {
    if (currentProjectId) {
      openTaskModal();
    }
  }, [currentProjectId, openTaskModal]);

  const handleStartCreateTaskFromSidebar = useCallback(
    (project: Project) => {
      navigate('project', { projectId: project.id });
      openTaskModal();
    },
    [navigate, openTaskModal]
  );

  // ---------------------------------------------------------------------------
  // Delete task mutation
  // ---------------------------------------------------------------------------
  const deleteTaskMutation = useMutation({
    mutationFn: async ({
      project,
      task,
      options,
    }: {
      project: Project;
      task: Task;
      options?: { silent?: boolean };
    }) => {
      await runLifecycleTeardownBestEffort(project, task, 'delete', options);

      try {
        const { initialPromptSentKey } = await import('../lib/keys');
        try {
          localStorage.removeItem(initialPromptSentKey(task.id));
        } catch {}
        try {
          for (const p of TERMINAL_PROVIDER_IDS) {
            localStorage.removeItem(initialPromptSentKey(task.id, p));
          }
        } catch {}
      } catch {}

      // PTY kills and snapshot cleanup are handled by the main process via deleteTask RPC.
      // Only clean up renderer-side state here.
      cleanupRendererResources(task);

      // Worktree removal and DB deletion are both handled by rpc.tasks.deleteTask in main.
      await rpc.tasks.deleteTask(task.id);

      for (const lifecycleTaskId of getLifecycleTaskIds(task)) {
        try {
          await rpc.lifecycle.clearTask({ taskId: lifecycleTaskId });
        } catch {}
      }

      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('task_deleted');
      });
    },
    onMutate: ({ project, task }) => {
      if (deletingTaskIdsRef.current.has(task.id)) return { blocked: true };
      deletingTaskIdsRef.current.add(task.id);
      const wasActive = currentTaskId === task.id;
      removeTaskFromCache(project.id, task.id, wasActive);
      return { task, wasActive, blocked: false };
    },
    onError: async (_err, { project, task }, context) => {
      if (context?.blocked) return;
      deletingTaskIdsRef.current.delete(task.id);
      const { log } = await import('../lib/logger');
      log.error('Failed to delete task:', _err as any);
      toast({
        title: 'Error',
        description:
          _err instanceof Error
            ? _err.message
            : 'Could not delete task. Check the console for details.',
        variant: 'destructive',
      });
      // Rollback: refresh from DB
      queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });
      if (context?.wasActive && context.task) handleSelectTask(context.task);
    },
    onSuccess: (_, { project, task }, context) => {
      if (context?.blocked) return;
      deletingTaskIdsRef.current.delete(task.id);
      queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });
      queryClient.invalidateQueries({ queryKey: ['archivedTasks', project.id] });
    },
  });

  const handleDeleteTask = useCallback(
    async (
      targetProject: Project,
      task: Task,
      options?: { silent?: boolean }
    ): Promise<boolean> => {
      if (deletingTaskIdsRef.current.has(task.id)) {
        toast({
          title: 'Deletion in progress',
          description: `"${task.name}" is already being removed.`,
        });
        return false;
      }
      try {
        await deleteTaskMutation.mutateAsync({ project: targetProject, task, options });
        return true;
      } catch {
        return false;
      }
    },
    [deleteTaskMutation, toast]
  );

  // ---------------------------------------------------------------------------
  // Archive task mutation
  // ---------------------------------------------------------------------------
  const archiveTaskMutation = useMutation({
    mutationFn: async ({
      project,
      task,
      options,
    }: {
      project: Project;
      task: Task;
      options?: { silent?: boolean };
    }) => {
      cleanupRendererResources(task);

      await runLifecycleTeardownBestEffort(project, task, 'archive', options);
      await rpc.db.archiveTask(task.id);

      for (const lifecycleTaskId of getLifecycleTaskIds(task)) {
        try {
          await rpc.lifecycle.clearTask({ taskId: lifecycleTaskId });
        } catch {}
      }

      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('task_archived');
      });
    },
    onMutate: ({ project, task }) => {
      if (archivingTaskIdsRef.current.has(task.id)) return { blocked: true };
      archivingTaskIdsRef.current.add(task.id);
      const wasActive = currentTaskId === task.id;
      removeTaskFromCache(project.id, task.id, wasActive);
      return { task, wasActive, blocked: false };
    },
    onError: async (_err, { project, task }, context) => {
      if (context?.blocked) return;
      archivingTaskIdsRef.current.delete(task.id);
      const { log } = await import('../lib/logger');
      log.error('Failed to archive task:', _err as any);
      // Rollback: refresh from DB
      queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });
      if (context?.wasActive && context.task) handleSelectTask(context.task);
      toast({
        title: 'Error',
        description: _err instanceof Error ? _err.message : 'Could not archive task.',
        variant: 'destructive',
      });
    },
    onSuccess: (_, { project, task, options }, context) => {
      if (context?.blocked) return;
      archivingTaskIdsRef.current.delete(task.id);
      queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });
      queryClient.invalidateQueries({ queryKey: ['archivedTasks', project.id] });
      if (!options?.silent) {
        toast({ title: 'Task archived', description: task.name });
      }
    },
  });

  const handleArchiveTask = useCallback(
    async (
      targetProject: Project,
      task: Task,
      options?: { silent?: boolean }
    ): Promise<boolean> => {
      if (archivingTaskIdsRef.current.has(task.id)) return false;
      try {
        await archiveTaskMutation.mutateAsync({ project: targetProject, task, options });
        return true;
      } catch {
        return false;
      }
    },
    [archiveTaskMutation]
  );

  // ---------------------------------------------------------------------------
  // Restore task mutation
  // ---------------------------------------------------------------------------
  const restoreTaskMutation = useMutation({
    mutationFn: async ({ project, task }: { project: Project; task: Task }) => {
      await rpc.db.restoreTask(task.id);
      const refreshedTasks = (await rpc.db.getTasks(project.id)) as Task[];
      const restoredTask = refreshedTasks.find((t) => t.id === task.id) ?? {
        ...task,
        archivedAt: null,
      };

      if (restoredTask) {
        try {
          await runSetupForTask(restoredTask, project.path);
        } catch {}
      }

      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('task_restored');
      });

      return { refreshedTasks, restoredTask };
    },
    onMutate: ({ task }) => {
      if (restoringTaskIdsRef.current.has(task.id)) return { blocked: true };
      restoringTaskIdsRef.current.add(task.id);
      return { blocked: false };
    },
    onError: async (_err, _vars, context) => {
      if (context?.blocked) return;
      restoringTaskIdsRef.current.delete(_vars.task.id);
      const { log } = await import('../lib/logger');
      log.error('Failed to restore task:', _err);
      toast({
        title: 'Error',
        description: _err instanceof Error ? _err.message : 'Could not restore task.',
        variant: 'destructive',
      });
    },
    onSuccess: ({ refreshedTasks }, { project, task }, context) => {
      if (context?.blocked) return;
      restoringTaskIdsRef.current.delete(task.id);
      queryClient.setQueryData<Task[]>(['tasks', project.id], refreshedTasks);
      queryClient.invalidateQueries({ queryKey: ['archivedTasks', project.id] });
      toast({ title: 'Task restored', description: task.name });
    },
  });

  const handleRestoreTask = useCallback(
    async (targetProject: Project, task: Task): Promise<void> => {
      if (restoringTaskIdsRef.current.has(task.id)) return;
      try {
        await restoreTaskMutation.mutateAsync({ project: targetProject, task });
      } catch {}
    },
    [restoreTaskMutation]
  );

  // ---------------------------------------------------------------------------
  // Rename task mutation
  // ---------------------------------------------------------------------------
  const renameTaskMutation = useMutation({
    mutationFn: async ({
      task,
      newName,
      newBranch,
    }: {
      project: Project;
      task: Task;
      newName: string;
      newBranch: string;
    }) => {
      const oldBranch = task.branch;
      let branchRenamed = false;

      if (newBranch !== oldBranch) {
        const branchResult = await rpc.git.renameBranch({
          repoPath: task.path,
          oldBranch,
          newBranch,
        });
        if (!branchResult?.success) {
          throw new Error(branchResult?.error || 'Failed to rename branch');
        }
        branchRenamed = true;
      }

      const updatedMetadata = task.metadata?.nameGenerated
        ? { ...task.metadata, nameGenerated: null }
        : task.metadata;

      try {
        await rpc.db.saveTask({
          ...task,
          name: newName,
          branch: newBranch,
          metadata: updatedMetadata,
        });
      } catch (err) {
        if (branchRenamed) {
          try {
            await rpc.git.renameBranch({
              repoPath: task.path,
              oldBranch: newBranch,
              newBranch: oldBranch,
            });
          } catch (rollbackErr) {
            const { log } = await import('../lib/logger');
            log.error('Failed to rollback branch rename:', rollbackErr as any);
          }
        }
        throw err;
      }
    },
    onMutate: ({ project, task, newName, newBranch }) => {
      // Optimistic cache update
      updateTaskCache(project.id, (old) =>
        old.map((t) => {
          if (t.id !== task.id) return t;
          const updated = { ...t, name: newName, branch: newBranch };
          if (updated.metadata?.nameGenerated) {
            updated.metadata = { ...updated.metadata, nameGenerated: null };
          }
          return updated;
        })
      );
      return { task }; // snapshot for rollback
    },
    onError: async (_err, { project }) => {
      const { log } = await import('../lib/logger');
      log.error('Failed to rename task:', _err);
      // Rollback optimistic update
      queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });
      toast({
        title: 'Error',
        description: _err instanceof Error ? _err.message : 'Could not rename task.',
        variant: 'destructive',
      });
    },
    onSuccess: (_, { project }) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });
    },
  });

  const handleRenameTask = useCallback(
    async (targetProject: Project, task: Task, newName: string) => {
      const oldBranch = task.branch;
      let newBranch: string;
      const branchMatch = oldBranch.match(/^([^/]+)\/(.+)-([a-z0-9]+)$/i);
      if (branchMatch) {
        const [, prefix, , hash] = branchMatch;
        const sluggedName = newName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        newBranch = `${prefix}/${sluggedName}-${hash}`;
      } else {
        newBranch = oldBranch;
      }
      await renameTaskMutation.mutateAsync({
        project: targetProject,
        task,
        newName,
        newBranch,
      });
    },
    [renameTaskMutation]
  );

  // ---------------------------------------------------------------------------
  // Create task mutation
  // ---------------------------------------------------------------------------
  const createTaskMutation = useMutation({
    mutationFn: (params: Parameters<typeof createTask>[0]) => createTask(params),
    onMutate: (params) => {
      const totalRuns = params.agentRuns.reduce((sum, ar) => sum + ar.runs, 0);
      const isMultiAgent = totalRuns > 1;
      const primaryAgent = params.agentRuns[0]?.agent || 'claude';
      const optimisticId = `optimistic-${Date.now()}`;

      const optimisticTask: Task = {
        id: optimisticId,
        projectId: params.project.id,
        name: params.taskName,
        branch: params.project.gitInfo.branch || 'main',
        path: params.project.path,
        status: 'idle',
        agentId: primaryAgent,
        metadata: isMultiAgent
          ? {
              multiAgent: {
                enabled: true,
                maxAgents: 4,
                agentRuns: params.agentRuns,
                variants: [],
                selectedAgent: null,
              },
            }
          : null,
        useWorktree: params.useWorktree,
      };

      updateTaskCache(params.project.id, (old) => [optimisticTask, ...old]);
      navigate('task', { projectId: params.project.id, taskId: optimisticId });
      return { optimisticTask };
    },
    onSuccess: ({ task, warning }, params, context) => {
      const { optimisticTask } = context ?? {};
      // Replace the optimistic placeholder with the real task
      updateTaskCache(params.project.id, (old) =>
        old.map((t) => (t.id === optimisticTask?.id ? task : t))
      );
      // Update navigation to the real task ID
      navigate('task', { projectId: task.projectId, taskId: task.id });
      queryClient.invalidateQueries({ queryKey: ['tasks', params.project.id] });
      if (warning) {
        toast({ title: 'Warning', description: warning });
      }
    },
    onError: (_err, params, context) => {
      const { optimisticTask } = context ?? {};
      if (optimisticTask) {
        updateTaskCache(params.project.id, (old) => old.filter((t) => t.id !== optimisticTask.id));
      }
      navigate('project', { projectId: params.project.id });
      queryClient.invalidateQueries({ queryKey: ['tasks', params.project.id] });
      setIsCreatingTask(false);
      toast({
        title: 'Error',
        description:
          _err instanceof Error ? _err.message : 'Failed to create task. Please check the console.',
        variant: 'destructive',
      });
    },
  });

  const handleCreateTask = useCallback(
    (
      taskName: string,
      initialPrompt?: string,
      agentRuns: AgentRun[] = [{ agent: 'claude', runs: 1 }],
      linkedLinearIssue: LinearIssueSummary | null = null,
      linkedGithubIssue: GitHubIssueSummary | null = null,
      linkedJiraIssue: JiraIssueSummary | null = null,
      autoApprove?: boolean,
      useWorktree: boolean = true,
      baseRef?: string,
      nameGenerated?: boolean
    ) => {
      const project = projects.find((p) => p.id === currentProjectId);
      if (!project) return;
      setIsCreatingTask(true);
      createTaskMutation.mutate({
        project,
        taskName,
        initialPrompt,
        agentRuns,
        linkedLinearIssue,
        linkedGithubIssue,
        linkedJiraIssue,
        autoApprove,
        nameGenerated,
        useWorktree,
        baseRef,
      });
    },
    [currentProjectId, projects, createTaskMutation]
  );

  const handleTaskInterfaceReady = useCallback(() => {
    setIsCreatingTask(false);
  }, []);

  // isCreatingTask safety-net: clear after 30s if task interface never signals ready
  useEffect(() => {
    if (!isCreatingTask) return;
    const timeout = window.setTimeout(() => {
      setIsCreatingTask(false);
    }, 30000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [isCreatingTask]);

  // Wire up openTaskModal with the latest handleCreateTask
  openTaskModalImplRef.current = () => {
    showModal('taskModal', {
      onSuccess: (result) =>
        handleCreateTask(
          result.name,
          result.initialPrompt,
          result.agentRuns,
          result.linkedLinearIssue ?? null,
          result.linkedGithubIssue ?? null,
          result.linkedJiraIssue ?? null,
          result.autoApprove,
          result.useWorktree,
          result.baseRef,
          result.nameGenerated
        ),
    });
  };

  // Auto-open task modal when project management requests it
  useEffect(() => {
    if (autoOpenTaskModalTrigger > 0) {
      openTaskModal();
    }
  }, [autoOpenTaskModalTrigger, openTaskModal]);

  return {
    allTasks,
    tasksByProjectId,
    archivedTasksByProjectId,
    linkedGithubIssueMap,
    isCreatingTask,
    handleCreateTask,
    handleTaskInterfaceReady,
    openTaskModal,
    handleSelectTask,
    handleNextTask,
    handlePrevTask,
    handleNewTask,
    handleStartCreateTaskFromSidebar,
    handleDeleteTask,
    handleRenameTask,
    handleArchiveTask,
    handleRestoreTask,
  };
}
