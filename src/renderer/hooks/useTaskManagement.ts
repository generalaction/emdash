import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { TERMINAL_PROVIDER_IDS } from '../constants/agents';
import { makePtyId } from '@shared/ptyId';
import type { ProviderId } from '@shared/providers/registry';
import { saveActiveIds, getStoredActiveIds } from '../constants/layout';
import { getAgentForTask } from '../lib/getAgentForTask';
import { disposeTaskTerminals } from '../lib/taskTerminalsStore';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import type { Agent } from '../types';
import type { Project, Task } from '../types/app';
import type { GitHubIssueLink, AgentRun } from '../types/chat';
import type { LinearIssueSummary } from '../types/linear';
import type { GitHubIssueSummary } from '../types/github';
import type { JiraIssueSummary } from '../types/jira';
import type { PlainThreadSummary } from '../types/plain';
import type { GitLabIssueSummary } from '../types/gitlab';
import type { ForgejoIssueSummary } from '../types/forgejo';
import { upsertTaskInList } from '../lib/taskListCache';
import { rpc } from '../lib/rpc';
import { createTask } from '../lib/taskCreationService';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';
import { useToast } from './use-toast';
import { useModalContext } from '../contexts/ModalProvider';

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
      window.electronAPI.lifecycleSetup({
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

/**
 * If the task has a workspace provider, terminate the remote workspace instance.
 * Best-effort — logs warnings but does not throw.
 */
const terminateWorkspaceIfNeeded = async (
  project: Project,
  task: Task,
  toastFn?: (opts: { title: string; description: string }) => void
): Promise<void> => {
  const workspaceConfig = task.metadata?.workspace;
  if (!workspaceConfig?.terminateCommand) return;

  try {
    const statusResult = await window.electronAPI.workspaceStatus({ taskId: task.id });
    if (!statusResult.success || !statusResult.data) return;

    const instance = statusResult.data;
    if (instance.status === 'terminated') return;

    const terminateResult = await window.electronAPI.workspaceTerminate({
      instanceId: instance.id,
      terminateCommand: workspaceConfig.terminateCommand,
      projectPath: project.path,
    });
    if (terminateResult.success) {
      toastFn?.({
        title: 'Workspace terminated',
        description: 'Remote workspace has been shut down.',
      });
    } else {
      toastFn?.({
        title: 'Workspace teardown failed',
        description: terminateResult.error || 'Terminate script failed.',
      });
    }
  } catch (err) {
    const { log } = await import('../lib/logger');
    log.warn('Workspace termination failed during task cleanup:', err as any);
  }
};

const cleanupPtyResources = async (task: Task): Promise<void> => {
  try {
    const variants = task.metadata?.multiAgent?.variants || [];
    const mainSessionIds: string[] = [];
    if (variants.length > 0) {
      for (const v of variants) {
        const id = `${v.worktreeId}-main`;
        mainSessionIds.push(id);
      }
    } else {
      for (const provider of TERMINAL_PROVIDER_IDS) {
        const id = makePtyId(provider, 'main', task.id);
        mainSessionIds.push(id);
      }
    }

    const chatSessionIds: string[] = [];
    try {
      const conversations = await rpc.db.getConversations(task.id);
      for (const conv of conversations) {
        if (!conv.isMain && conv.provider) {
          const chatId = makePtyId(conv.provider as ProviderId, 'chat', conv.id);
          chatSessionIds.push(chatId);
        }
      }
    } catch {}

    const sessionIds = [...mainSessionIds, ...chatSessionIds];
    for (const sessionId of sessionIds) {
      try {
        terminalSessionRegistry.dispose(sessionId);
      } catch {}
    }
    if (sessionIds.length > 0) {
      try {
        await window.electronAPI.ptyCleanupSessions({
          ids: sessionIds,
          clearSnapshots: true,
          waitForSnapshots: false,
        });
      } catch {}
    }

    const variantPaths = (task.metadata?.multiAgent?.variants || []).map((v) => v.path);
    const pathsToClean = variantPaths.length > 0 ? variantPaths : [task.path];
    for (const path of pathsToClean) {
      disposeTaskTerminals(`${task.id}::${path}`);
      if (task.useWorktree !== false) {
        disposeTaskTerminals(`global::${path}`);
      }
    }
    disposeTaskTerminals(task.id);
  } catch (err) {
    const { log } = await import('../lib/logger');
    log.error('Error cleaning up PTY resources:', err as any);
  }
};

export function useTaskManagement() {
  const {
    projects,
    selectedProject,
    setSelectedProject,
    setShowHomeView,
    setShowSkillsView,
    setShowMcpView,
    setShowAutomationsView,
    setShowEditorMode,
    setShowKanban,
    activateProjectView,
    resetTaskTrigger,
    autoOpenTaskModalTrigger,
  } = useProjectManagementContext();

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
    () => buildLinkedGithubIssueMap(selectedProject ? tasksByProjectId[selectedProject.id] : null),
    [selectedProject, tasksByProjectId]
  );

  // ---------------------------------------------------------------------------
  // Local UI state
  // ---------------------------------------------------------------------------
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskAgent, setActiveTaskAgent] = useState<Agent | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const deletingTaskIdsRef = useRef<Set<string>>(new Set());
  const restoringTaskIdsRef = useRef<Set<string>>(new Set());
  const archivingTaskIdsRef = useRef<Set<string>>(new Set());
  const openTaskModalImplRef = useRef<(project?: Project) => void>(() => {});
  const pendingTaskProjectRef = useRef<Project | null>(null);
  const preflightPromiseRef = useRef<Promise<unknown> | undefined>(undefined);
  const openTaskModal = useCallback(
    (project?: Project) => openTaskModalImplRef.current(project),
    []
  );

  // Reset active task when project management signals a navigation away
  useEffect(() => {
    if (resetTaskTrigger > 0) {
      setActiveTask(null);
      setActiveTaskAgent(null);
    }
  }, [resetTaskTrigger]);

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
      const stored = getStoredActiveIds();
      if (stored.taskId === taskId) {
        saveActiveIds(stored.projectId, null);
      }
      if (wasActive) {
        setActiveTask(null);
        setActiveTaskAgent(null);
      }
    },
    [updateTaskCache]
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
      lifecycleTargets.map((target) =>
        window.electronAPI.lifecycleRunStop({
          taskId: target.taskId,
          taskPath: target.taskPath,
          projectPath: targetProject.path,
          taskName: target.label,
        })
      )
    );

    for (const target of lifecycleTargets) {
      try {
        const teardownPromise = window.electronAPI.lifecycleTeardown({
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
        if (!result?.success && !result?.skipped) {
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
      const taskProject = projects.find((project) => project.id === task.projectId);
      const isProjectSwitch = !selectedProject || selectedProject.id !== task.projectId;
      if (isProjectSwitch) {
        setShowEditorMode(false);
      }
      if (taskProject && selectedProject?.id !== taskProject.id) {
        setSelectedProject(taskProject);
      }
      setShowHomeView(false);
      setShowSkillsView(false);
      setShowMcpView(false);
      setShowAutomationsView(false);
      setShowKanban(false);
      setActiveTask(task);
      setActiveTaskAgent(getAgentForTask(task));
      saveActiveIds(task.projectId, task.id);
    },
    [
      projects,
      selectedProject,
      setSelectedProject,
      setShowEditorMode,
      setShowHomeView,
      setShowSkillsView,
      setShowMcpView,
      setShowAutomationsView,
      setShowKanban,
    ]
  );

  const handleOpenExternalTask = useCallback(
    (task: Task) => {
      updateTaskCache(task.projectId, (old) => upsertTaskInList(old, task));
      handleSelectTask(task);
      void queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
    },
    [handleSelectTask, queryClient, updateTaskCache]
  );

  const handleNextTask = useCallback(() => {
    if (allTasks.length === 0) return;
    const currentIndex = activeTask
      ? allTasks.findIndex((t: { task: Task; project: Project }) => t.task.id === activeTask.id)
      : -1;
    const nextIndex = (currentIndex + 1) % allTasks.length;
    const { task, project } = allTasks[nextIndex];
    if (!selectedProject || selectedProject.id !== project.id) {
      setShowEditorMode(false);
      setShowKanban(false);
    }
    setSelectedProject(project);
    setShowHomeView(false);
    setShowSkillsView(false);
    setShowMcpView(false);
    setShowAutomationsView(false);
    setActiveTask(task);
    setActiveTaskAgent(getAgentForTask(task));
    saveActiveIds(project.id, task.id);
  }, [allTasks, activeTask, selectedProject]);

  const handlePrevTask = useCallback(() => {
    if (allTasks.length === 0) return;
    const currentIndex = activeTask
      ? allTasks.findIndex((t: { task: Task; project: Project }) => t.task.id === activeTask.id)
      : -1;
    const prevIndex = currentIndex <= 0 ? allTasks.length - 1 : currentIndex - 1;
    const { task, project } = allTasks[prevIndex];
    if (!selectedProject || selectedProject.id !== project.id) {
      setShowEditorMode(false);
      setShowKanban(false);
    }
    setSelectedProject(project);
    setShowHomeView(false);
    setShowSkillsView(false);
    setShowMcpView(false);
    setShowAutomationsView(false);
    setActiveTask(task);
    setActiveTaskAgent(getAgentForTask(task));
    saveActiveIds(project.id, task.id);
  }, [allTasks, activeTask, selectedProject]);

  const handleNewTask = useCallback(() => {
    if (selectedProject) {
      openTaskModal();
    }
  }, [selectedProject, openTaskModal]);

  const handleStartCreateTaskFromSidebar = useCallback(
    (project: Project) => {
      const targetProject = projects.find((p) => p.id === project.id) || project;
      if (!selectedProject || selectedProject.id !== targetProject.id) {
        activateProjectView(targetProject);
      }
      openTaskModal(targetProject);
    },
    [activateProjectView, projects, selectedProject, openTaskModal]
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

      // Terminate remote workspace if this task used workspace provisioning
      await terminateWorkspaceIfNeeded(project, task, toast);

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

      const variants = task.metadata?.multiAgent?.variants || [];
      const mainSessionIds: string[] = [];
      if (variants.length > 0) {
        for (const v of variants) {
          const id = `${v.worktreeId}-main`;
          mainSessionIds.push(id);
        }
      } else {
        for (const provider of TERMINAL_PROVIDER_IDS) {
          const id = makePtyId(provider, 'main', task.id);
          mainSessionIds.push(id);
        }
      }

      const chatSessionIds: string[] = [];
      try {
        const conversations = await rpc.db.getConversations(task.id);
        for (const conv of conversations) {
          if (!conv.isMain && conv.provider) {
            const chatId = makePtyId(conv.provider as ProviderId, 'chat', conv.id);
            chatSessionIds.push(chatId);
          }
        }
      } catch {}

      const sessionIds = [...mainSessionIds, ...chatSessionIds];
      for (const sessionId of sessionIds) {
        try {
          terminalSessionRegistry.dispose(sessionId);
        } catch {}
      }
      if (sessionIds.length > 0) {
        try {
          await window.electronAPI.ptyCleanupSessions({
            ids: sessionIds,
            clearSnapshots: true,
            waitForSnapshots: false,
          });
        } catch {}
      }

      const variantPaths = (task.metadata?.multiAgent?.variants || []).map((v) => v.path);
      const pathsToClean = variantPaths.length > 0 ? variantPaths : [task.path];
      for (const path of pathsToClean) {
        disposeTaskTerminals(`${task.id}::${path}`);
        if (task.useWorktree !== false) {
          disposeTaskTerminals(`global::${path}`);
        }
      }
      disposeTaskTerminals(task.id);

      const shouldRemoveWorktree = task.useWorktree !== false;
      const promises: Promise<any>[] = [rpc.db.deleteTask(task.id)];

      if (shouldRemoveWorktree) {
        if (task.path === project.path) {
          console.warn(
            `Task "${task.name}" appears to be running on main repo, skipping worktree removal`
          );
        } else {
          promises.unshift(
            window.electronAPI.worktreeRemove({
              projectPath: project.path,
              worktreeId: task.id,
              worktreePath: task.path,
              branch: task.branch,
              taskName: task.name,
            })
          );
        }
      }

      const results = await Promise.allSettled(promises);

      if (shouldRemoveWorktree) {
        const removeResult = results[0];
        if (removeResult.status !== 'fulfilled' || !removeResult.value?.success) {
          const errorMsg =
            removeResult.status === 'fulfilled'
              ? removeResult.value?.error || 'Failed to remove worktree'
              : removeResult.reason?.message || String(removeResult.reason);
          throw new Error(errorMsg);
        }
      }

      const deleteResult = shouldRemoveWorktree ? results[1] : results[0];
      if (deleteResult.status !== 'fulfilled') {
        throw new Error(
          deleteResult.reason?.message || String(deleteResult.reason) || 'Failed to delete task'
        );
      }

      await Promise.allSettled(
        getLifecycleTaskIds(task).map(async (lifecycleTaskId) => {
          try {
            await window.electronAPI.lifecycleClearTask({ taskId: lifecycleTaskId });
          } catch {}
        })
      );

      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('task_deleted');
      });
    },
    onMutate: ({ project, task }) => {
      if (deletingTaskIdsRef.current.has(task.id)) return { blocked: true };
      deletingTaskIdsRef.current.add(task.id);
      const wasActive = activeTask?.id === task.id;
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
      // PTY cleanup in background — don't block the UI
      void cleanupPtyResources(task);

      await runLifecycleTeardownBestEffort(project, task, 'archive', options);

      // Terminate remote workspace if this task used workspace provisioning
      await terminateWorkspaceIfNeeded(project, task, toast);

      await rpc.db.archiveTask(task.id);

      for (const lifecycleTaskId of getLifecycleTaskIds(task)) {
        try {
          await window.electronAPI.lifecycleClearTask({ taskId: lifecycleTaskId });
        } catch {}
      }

      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('task_archived');
      });
    },
    onMutate: ({ project, task }) => {
      if (archivingTaskIdsRef.current.has(task.id)) return { blocked: true };
      archivingTaskIdsRef.current.add(task.id);
      const wasActive = activeTask?.id === task.id;
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
    onMutate: ({ project, task }) => {
      if (restoringTaskIdsRef.current.has(task.id)) return { blocked: true };
      restoringTaskIdsRef.current.add(task.id);
      return { blocked: false };
    },
    onError: async (_err, _vars, context) => {
      if (context?.blocked) return;
      restoringTaskIdsRef.current.delete(_vars.task.id);
      const { log } = await import('../lib/logger');
      log.error('Failed to restore task:', _err as any);
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
      project,
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
        const branchResult = await window.electronAPI.renameBranch({
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
            await window.electronAPI.renameBranch({
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
      setActiveTask((prev) => {
        if (prev?.id !== task.id) return prev;
        const updated = { ...prev, name: newName, branch: newBranch };
        if (updated.metadata?.nameGenerated) {
          updated.metadata = { ...updated.metadata, nameGenerated: null };
        }
        return updated;
      });
      return { task }; // snapshot for rollback
    },
    onError: async (_err, { project, task }, context) => {
      const { log } = await import('../lib/logger');
      log.error('Failed to rename task:', _err as any);
      // Rollback optimistic update
      queryClient.invalidateQueries({ queryKey: ['tasks', project.id] });
      setActiveTask((prev) => (prev?.id === task.id ? (context?.task ?? prev) : prev));
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
      setActiveTask(optimisticTask);
      setActiveTaskAgent(isMultiAgent ? null : getAgentForTask(optimisticTask));
      saveActiveIds(params.project.id, optimisticId);
      return { optimisticTask };
    },
    onSuccess: ({ task, warning }, params, context) => {
      const { optimisticTask } = context ?? {};
      // Replace the optimistic placeholder with the real task
      updateTaskCache(params.project.id, (old) =>
        old.map((t) => (t.id === optimisticTask?.id ? task : t))
      );
      setActiveTask((current) => (current?.id === optimisticTask?.id ? task : current));
      setActiveTaskAgent(getAgentForTask(task));
      saveActiveIds(task.projectId, task.id);
      queryClient.invalidateQueries({ queryKey: ['tasks', params.project.id] });
      toast({
        title: 'Task started',
        description: task.name,
      });
      if (warning) {
        toast({ title: 'Warning', description: warning });
      }
    },
    onError: (_err, params, context) => {
      const { optimisticTask } = context ?? {};
      if (optimisticTask) {
        updateTaskCache(params.project.id, (old) => old.filter((t) => t.id !== optimisticTask.id));
        setActiveTask((current) => (current?.id === optimisticTask.id ? null : current));
      }
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
    async (
      taskName: string,
      initialPrompt?: string,
      agentRuns: AgentRun[] = [{ agent: 'claude', runs: 1 }],
      linkedLinearIssue: LinearIssueSummary | null = null,
      linkedGithubIssue: GitHubIssueSummary | null = null,
      linkedJiraIssue: JiraIssueSummary | null = null,
      linkedPlainThread: PlainThreadSummary | null = null,
      linkedGitlabIssue: GitLabIssueSummary | null = null,
      linkedForgejoIssue: ForgejoIssueSummary | null = null,
      autoApprove?: boolean,
      useWorktree: boolean = true,
      baseRef?: string,
      nameGenerated?: boolean,
      useRemoteWorkspace?: boolean,
      workspaceProvider?: { provisionCommand: string; terminateCommand: string },
      overrideProject?: Project
    ) => {
      const targetProject = overrideProject ?? pendingTaskProjectRef.current ?? selectedProject;
      pendingTaskProjectRef.current = null;
      if (!targetProject) return;
      setIsCreatingTask(true);
      const preflight = preflightPromiseRef.current;
      preflightPromiseRef.current = undefined;
      await createTaskMutation.mutateAsync({
        project: targetProject,
        taskName,
        initialPrompt,
        agentRuns,
        linkedLinearIssue,
        linkedGithubIssue,
        linkedJiraIssue,
        linkedPlainThread,
        linkedGitlabIssue,
        linkedForgejoIssue,
        autoApprove,
        nameGenerated,
        useWorktree,
        baseRef,
        useRemoteWorkspace,
        workspaceProvider,
        preflightPromise: preflight,
      });
    },
    [selectedProject, createTaskMutation]
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

  // Wire up openTaskModal — TaskModalOverlay calls handleCreateTask via context
  openTaskModalImplRef.current = (project?: Project) => {
    if (project === undefined) pendingTaskProjectRef.current = null;

    // Fire preflight reserve freshness check while the user fills in the form.
    const targetProject = project ?? pendingTaskProjectRef.current ?? selectedProject;
    if (targetProject) {
      preflightPromiseRef.current = window.electronAPI
        .worktreePreflightReserve({
          projectId: targetProject.id,
          projectPath: targetProject.path,
        })
        .catch((err) => {
          console.warn('[preflight] failed', err);
        });
    }

    showModal('taskModal', {
      initialProject: project,
      onClose: () => {
        pendingTaskProjectRef.current = null;
        preflightPromiseRef.current = undefined;
      },
    });
  };

  // Auto-open task modal when project management requests it
  useEffect(() => {
    if (autoOpenTaskModalTrigger > 0) {
      openTaskModal();
    }
  }, [autoOpenTaskModalTrigger, openTaskModal]);

  // ---------------------------------------------------------------------------
  // Pin / unpin task (persisted in task metadata)
  // ---------------------------------------------------------------------------
  const handlePinTask = useCallback(
    async (task: Task) => {
      const isPinned = !task.metadata?.isPinned;
      const updatedMetadata = { ...task.metadata, isPinned: isPinned || null };
      // Optimistic UI update
      updateTaskCache(task.projectId, (old) =>
        old.map((t) => (t.id === task.id ? { ...t, metadata: updatedMetadata } : t))
      );
      try {
        await rpc.db.saveTask({ ...task, metadata: updatedMetadata });
      } catch {
        // Rollback on failure
        queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] });
      }
    },
    [updateTaskCache, queryClient]
  );

  return {
    activeTask,
    setActiveTask,
    activeTaskAgent,
    setActiveTaskAgent,
    allTasks,
    tasksByProjectId,
    archivedTasksByProjectId,
    linkedGithubIssueMap,
    isCreatingTask,
    handleCreateTask,
    handleTaskInterfaceReady,
    openTaskModal,
    handleSelectTask,
    handleOpenExternalTask,
    handleNextTask,
    handlePrevTask,
    handleNewTask,
    handleStartCreateTaskFromSidebar,
    handleDeleteTask,
    handleRenameTask,
    handleArchiveTask,
    handleRestoreTask,
    handlePinTask,
  };
}
