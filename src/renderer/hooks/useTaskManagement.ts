import { useState, useMemo, useCallback, useRef } from 'react';
import { TERMINAL_PROVIDER_IDS } from '../constants/agents';
import { saveActiveIds, getStoredActiveIds } from '../constants/layout';
import { getAgentForTask } from '../lib/getAgentForTask';
import { disposeTaskTerminals } from '../lib/taskTerminalsStore';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import type { Agent } from '../types';
import type { Project, Task } from '../types/app';
import type { GitHubIssueLink } from '../types/chat';

const LIFECYCLE_TEARDOWN_TIMEOUT_MS = 15000;

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

interface UseTaskManagementOptions {
  projects: Project[];
  selectedProject: Project | null;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setSelectedProject: React.Dispatch<React.SetStateAction<Project | null>>;
  setShowHomeView: React.Dispatch<React.SetStateAction<boolean>>;
  setShowEditorMode: React.Dispatch<React.SetStateAction<boolean>>;
  setShowKanban: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTaskModal: React.Dispatch<React.SetStateAction<boolean>>;
  toast: (opts: any) => void;
  activateProjectView: (project: Project) => void;
}

export function useTaskManagement(options: UseTaskManagementOptions) {
  const {
    projects,
    selectedProject,
    setProjects,
    setSelectedProject,
    setShowHomeView,
    setShowEditorMode,
    setShowKanban,
    setShowTaskModal,
    toast,
    activateProjectView,
  } = options;

  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskAgent, setActiveTaskAgent] = useState<Agent | null>(null);
  const [archivedTasksVersion, setArchivedTasksVersion] = useState(0);
  const deletingTaskIdsRef = useRef<Set<string>>(new Set());
  const restoringTaskIdsRef = useRef<Set<string>>(new Set());
  const archivingTaskIdsRef = useRef<Set<string>>(new Set());

  // Collect all tasks across all projects for cycling
  const allTasks = useMemo(() => {
    const tasks: { task: Task; project: Project }[] = [];
    for (const project of projects) {
      for (const task of project.tasks || []) {
        tasks.push({ task, project });
      }
    }
    return tasks;
  }, [projects]);

  const linkedGithubIssueMap = useMemo(
    () => buildLinkedGithubIssueMap(selectedProject?.tasks),
    [selectedProject?.tasks]
  );

  const handleSelectTask = (task: Task) => {
    setActiveTask(task);
    setActiveTaskAgent(getAgentForTask(task));
    saveActiveIds(task.projectId, task.id);
  };

  const handleNextTask = useCallback(() => {
    if (allTasks.length === 0) return;
    const currentIndex = activeTask
      ? allTasks.findIndex((t: { task: Task; project: Project }) => t.task.id === activeTask.id)
      : -1;
    const nextIndex = (currentIndex + 1) % allTasks.length;
    const { task, project } = allTasks[nextIndex];
    // Only reset view state when actually switching projects
    if (!selectedProject || selectedProject.id !== project.id) {
      setShowEditorMode(false);
      setShowKanban(false);
    }
    setSelectedProject(project);
    setShowHomeView(false);
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
    // Only reset view state when actually switching projects
    if (!selectedProject || selectedProject.id !== project.id) {
      setShowEditorMode(false);
      setShowKanban(false);
    }
    setSelectedProject(project);
    setShowHomeView(false);
    setActiveTask(task);
    setActiveTaskAgent(getAgentForTask(task));
    saveActiveIds(project.id, task.id);
  }, [allTasks, activeTask, selectedProject]);

  const handleNewTask = useCallback(() => {
    // Only open modal if a project is selected
    if (selectedProject) {
      setShowTaskModal(true);
    }
  }, [selectedProject]);

  const handleStartCreateTaskFromSidebar = useCallback(
    (project: Project) => {
      const targetProject = projects.find((p) => p.id === project.id) || project;
      activateProjectView(targetProject);
      setShowTaskModal(true);
    },
    [activateProjectView, projects]
  );

  const removeTaskFromState = (projectId: string, taskId: string, wasActive: boolean) => {
    const filterTasks = (list?: Task[]) => (list || []).filter((w) => w.id !== taskId);

    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId ? { ...project, tasks: filterTasks(project.tasks) } : project
      )
    );

    setSelectedProject((prev) =>
      prev && prev.id === projectId ? { ...prev, tasks: filterTasks(prev.tasks) } : prev
    );

    // Clear stored task ID if this task was stored
    const stored = getStoredActiveIds();
    if (stored.taskId === taskId) {
      saveActiveIds(stored.projectId, null);
    }

    if (wasActive) {
      setActiveTask(null);
      setActiveTaskAgent(null);
    }
  };

  const runLifecycleTeardownBestEffort = async (
    targetProject: Project,
    task: Task,
    action: 'archive' | 'delete',
    options?: { silent?: boolean }
  ): Promise<void> => {
    const continueLabel = action === 'archive' ? 'archiving' : 'deletion';

    try {
      await window.electronAPI.lifecycleRunStop({ taskId: task.id });
    } catch {}

    try {
      const teardownPromise = window.electronAPI.lifecycleTeardown({
        taskId: task.id,
        taskPath: task.path,
        projectPath: targetProject.path,
      });
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        window.setTimeout(() => resolve('timeout'), LIFECYCLE_TEARDOWN_TIMEOUT_MS);
      });
      const result = await Promise.race([teardownPromise, timeoutPromise]);

      if (result === 'timeout') {
        const { log } = await import('../lib/logger');
        log.warn(
          `Lifecycle teardown timed out for task "${task.name}" after ${LIFECYCLE_TEARDOWN_TIMEOUT_MS}ms; continuing ${continueLabel}.`
        );
        if (!options?.silent) {
          toast({
            title: 'Teardown timed out',
            description: `Continuing ${continueLabel} for "${task.name}".`,
          });
        }
        return;
      }

      if (!result?.success && !result?.skipped) {
        const message = result?.error || 'Teardown script failed';
        const { log } = await import('../lib/logger');
        log.warn(
          `Lifecycle teardown failed for task "${task.name}"; continuing ${continueLabel}.`,
          message
        );
        if (!options?.silent) {
          toast({
            title: 'Teardown failed',
            description: `Continuing ${continueLabel}: ${message}`,
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const { log } = await import('../lib/logger');
      log.warn(
        `Lifecycle teardown errored for task "${task.name}"; continuing ${continueLabel}.`,
        message
      );
      if (!options?.silent) {
        toast({
          title: 'Teardown error',
          description: `Continuing ${continueLabel}: ${message}`,
        });
      }
    }
  };

  const handleDeleteTask = async (
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

    const wasActive = activeTask?.id === task.id;
    const taskSnapshot = { ...task };
    deletingTaskIdsRef.current.add(task.id);
    removeTaskFromState(targetProject.id, task.id, wasActive);

    const runDeletion = async (): Promise<boolean> => {
      try {
        await runLifecycleTeardownBestEffort(targetProject, task, 'delete', options);

        try {
          // Clear initial prompt sent flags (legacy and per-provider) if present
          const { initialPromptSentKey } = await import('../lib/keys');
          try {
            // Legacy key (no provider)
            const legacy = initialPromptSentKey(task.id);
            localStorage.removeItem(legacy);
          } catch {}
          try {
            // Provider-scoped keys
            for (const p of TERMINAL_PROVIDER_IDS) {
              const k = initialPromptSentKey(task.id, p);
              localStorage.removeItem(k);
            }
          } catch {}
        } catch {}
        // Kill main agent terminals
        // Single-agent: ${provider}-main-${task.id}
        // Multi-agent: ${variant.worktreeId}-main
        const variants = task.metadata?.multiAgent?.variants || [];
        const mainSessionIds: string[] = [];
        if (variants.length > 0) {
          for (const v of variants) {
            const id = `${v.worktreeId}-main`;
            mainSessionIds.push(id);
            try {
              window.electronAPI.ptyKill?.(id);
            } catch {}
          }
        } else {
          for (const provider of TERMINAL_PROVIDER_IDS) {
            const id = `${provider}-main-${task.id}`;
            mainSessionIds.push(id);
            try {
              window.electronAPI.ptyKill?.(id);
            } catch {}
          }
        }

        // Kill chat agent terminals (agents added via "+")
        const chatSessionIds: string[] = [];
        try {
          const convResult = await window.electronAPI.getConversations(task.id);
          if (convResult.success && convResult.conversations) {
            for (const conv of convResult.conversations) {
              if (!conv.isMain && conv.provider) {
                const chatId = `${conv.provider}-chat-${conv.id}`;
                chatSessionIds.push(chatId);
                try {
                  window.electronAPI.ptyKill?.(chatId);
                } catch {}
              }
            }
          }
        } catch {}

        const sessionIds = [...mainSessionIds, ...chatSessionIds];

        await Promise.allSettled(
          sessionIds.map(async (sessionId) => {
            try {
              terminalSessionRegistry.dispose(sessionId);
            } catch {}
            try {
              await window.electronAPI.ptyClearSnapshot({ id: sessionId });
            } catch {}
          })
        );

        // Clean up task terminal panel terminals (bottom-right shell terminals)
        // Multi-agent tasks have terminals per variant path
        const variantPaths = (task.metadata?.multiAgent?.variants || []).map((v) => v.path);
        const pathsToClean = variantPaths.length > 0 ? variantPaths : [task.path];
        for (const path of pathsToClean) {
          disposeTaskTerminals(`${task.id}::${path}`);
          // Global terminals are shared by non-worktree tasks on the same path
          if (task.useWorktree !== false) {
            disposeTaskTerminals(`global::${path}`);
          }
        }
        // ChatInterface uses task.id as key (single-agent tasks only)
        disposeTaskTerminals(task.id);

        // Only remove worktree if the task was created with one
        // IMPORTANT: Tasks without worktrees have useWorktree === false
        const shouldRemoveWorktree = task.useWorktree !== false;

        const promises: Promise<any>[] = [window.electronAPI.deleteTask(task.id)];

        if (shouldRemoveWorktree) {
          // Safety check: Don't try to remove worktree if the task path equals project path
          // This indicates a task without a worktree running directly on the main repo
          if (task.path === targetProject.path) {
            console.warn(
              `Task "${task.name}" appears to be running on main repo, skipping worktree removal`
            );
          } else {
            promises.unshift(
              window.electronAPI.worktreeRemove({
                projectPath: targetProject.path,
                worktreeId: task.id,
                worktreePath: task.path,
                branch: task.branch,
                taskName: task.name,
              })
            );
          }
        }

        const results = await Promise.allSettled(promises);

        // Check worktree removal result (if applicable)
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

        // Check task deletion result
        const deleteResult = shouldRemoveWorktree ? results[1] : results[0];
        if (deleteResult.status !== 'fulfilled' || !deleteResult.value?.success) {
          const errorMsg =
            deleteResult.status === 'fulfilled'
              ? deleteResult.value?.error || 'Failed to delete task'
              : deleteResult.reason?.message || String(deleteResult.reason);
          throw new Error(errorMsg);
        }

        try {
          await window.electronAPI.lifecycleClearTask({ taskId: task.id });
        } catch {}

        // Track task deletion
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('task_deleted');

        if (!options?.silent) {
          toast({
            title: 'Task deleted',
            description: task.name,
          });
        }
        return true;
      } catch (error) {
        const { log } = await import('../lib/logger');
        log.error('Failed to delete task:', error as any);
        toast({
          title: 'Error',
          description:
            error instanceof Error
              ? error.message
              : 'Could not delete task. Check the console for details.',
          variant: 'destructive',
        });

        try {
          const refreshedTasks = await window.electronAPI.getTasks(targetProject.id);
          setProjects((prev) =>
            prev.map((project) =>
              project.id === targetProject.id ? { ...project, tasks: refreshedTasks } : project
            )
          );
          setSelectedProject((prev) =>
            prev && prev.id === targetProject.id ? { ...prev, tasks: refreshedTasks } : prev
          );

          if (wasActive) {
            const restored = refreshedTasks.find((w) => w.id === task.id);
            if (restored) {
              handleSelectTask(restored);
            }
          }
        } catch (refreshError) {
          log.error('Failed to refresh tasks after delete failure:', refreshError as any);

          setProjects((prev) =>
            prev.map((project) => {
              if (project.id !== targetProject.id) return project;
              const existing = project.tasks || [];
              const alreadyPresent = existing.some((w) => w.id === taskSnapshot.id);
              return alreadyPresent ? project : { ...project, tasks: [taskSnapshot, ...existing] };
            })
          );
          setSelectedProject((prev) => {
            if (!prev || prev.id !== targetProject.id) return prev;
            const existing = prev.tasks || [];
            const alreadyPresent = existing.some((w) => w.id === taskSnapshot.id);
            return alreadyPresent ? prev : { ...prev, tasks: [taskSnapshot, ...existing] };
          });

          if (wasActive) {
            handleSelectTask(taskSnapshot);
          }
        }
        return false;
      } finally {
        deletingTaskIdsRef.current.delete(task.id);
      }
    };

    return runDeletion();
  };

  const handleRenameTask = async (targetProject: Project, task: Task, newName: string) => {
    const oldName = task.name;
    const oldBranch = task.branch;

    // Parse old branch to preserve prefix and hash: "prefix/name-hash"
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
      // Non-standard branch (direct mode) - keep unchanged
      newBranch = oldBranch;
    }

    // Helper to update task name and branch across all state locations
    const applyTaskChange = (name: string, branch: string) => {
      const updateTasks = (tasks: Task[] | undefined) =>
        tasks?.map((t) => (t.id === task.id ? { ...t, name, branch } : t));

      setProjects((prev) =>
        prev.map((project) =>
          project.id === targetProject.id
            ? { ...project, tasks: updateTasks(project.tasks) }
            : project
        )
      );
      setSelectedProject((prev) =>
        prev && prev.id === targetProject.id ? { ...prev, tasks: updateTasks(prev.tasks) } : prev
      );
      // Check inside updater to avoid stale closure
      setActiveTask((prev) => (prev?.id === task.id ? { ...prev, name, branch } : prev));
    };

    // Optimistically update local state
    applyTaskChange(newName, newBranch);

    let branchRenamed = false;
    try {
      let remotePushed = false;

      // Only rename git branch if it's actually changing
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
        remotePushed = branchResult.remotePushed ?? false;
      }

      // Save task with new name and branch
      const saveResult = await window.electronAPI.saveTask({
        ...task,
        name: newName,
        branch: newBranch,
      });

      if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'Failed to save task');
      }

      const remoteNote = remotePushed ? ' (remote updated)' : '';
      toast({
        title: 'Task renamed',
        description: `"${oldName}" → "${newName}"${remoteNote}`,
      });
    } catch (error) {
      const { log } = await import('../lib/logger');
      log.error('Failed to rename task:', error as any);

      // Rollback git branch if it was renamed
      if (branchRenamed) {
        try {
          await window.electronAPI.renameBranch({
            repoPath: task.path,
            oldBranch: newBranch,
            newBranch: oldBranch,
          });
        } catch (rollbackErr) {
          log.error('Failed to rollback branch rename:', rollbackErr as any);
        }
      }

      // Revert optimistic update
      applyTaskChange(oldName, oldBranch);

      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Could not rename task.',
        variant: 'destructive',
      });
    }
  };

  const handleArchiveTask = async (
    targetProject: Project,
    task: Task,
    options?: { silent?: boolean }
  ): Promise<boolean> => {
    if (archivingTaskIdsRef.current.has(task.id)) {
      return false;
    }

    archivingTaskIdsRef.current.add(task.id);
    const wasActive = activeTask?.id === task.id;
    const taskSnapshot = { ...task };

    try {
      // Optimistically remove from UI
      removeTaskFromState(targetProject.id, task.id, wasActive);

      // Clean up PTY resources in background (don't await - let UI update immediately)
      const cleanupPtyResources = async () => {
        try {
          // Kill main agent terminals
          const variants = task.metadata?.multiAgent?.variants || [];
          const mainSessionIds: string[] = [];
          if (variants.length > 0) {
            for (const v of variants) {
              const id = `${v.worktreeId}-main`;
              mainSessionIds.push(id);
              try {
                window.electronAPI.ptyKill?.(id);
              } catch {}
            }
          } else {
            for (const provider of TERMINAL_PROVIDER_IDS) {
              const id = `${provider}-main-${task.id}`;
              mainSessionIds.push(id);
              try {
                window.electronAPI.ptyKill?.(id);
              } catch {}
            }
          }

          // Kill chat agent terminals
          const chatSessionIds: string[] = [];
          try {
            const convResult = await window.electronAPI.getConversations(task.id);
            if (convResult.success && convResult.conversations) {
              for (const conv of convResult.conversations) {
                if (!conv.isMain && conv.provider) {
                  const chatId = `${conv.provider}-chat-${conv.id}`;
                  chatSessionIds.push(chatId);
                  try {
                    window.electronAPI.ptyKill?.(chatId);
                  } catch {}
                }
              }
            }
          } catch {}

          const sessionIds = [...mainSessionIds, ...chatSessionIds];

          await Promise.allSettled(
            sessionIds.map(async (sessionId) => {
              try {
                terminalSessionRegistry.dispose(sessionId);
              } catch {}
              try {
                await window.electronAPI.ptyClearSnapshot({ id: sessionId });
              } catch {}
            })
          );

          // Clean up task terminal panel terminals
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
          log.error('Error cleaning up PTY resources during archive:', err as any);
        }
      };

      // Start cleanup in background
      cleanupPtyResources();

      await runLifecycleTeardownBestEffort(targetProject, task, 'archive', options);

      try {
        const result = await window.electronAPI.archiveTask(task.id);

        if (!result?.success) {
          throw new Error(result?.error || 'Failed to archive task');
        }

        try {
          await window.electronAPI.lifecycleClearTask({ taskId: task.id });
        } catch {}

        // Track task archive
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('task_archived');

        // Signal sidebar to refresh archived tasks
        setArchivedTasksVersion((v) => v + 1);

        if (!options?.silent) {
          toast({
            title: 'Task archived',
            description: task.name,
          });
        }

        return true;
      } catch (error) {
        const { log } = await import('../lib/logger');
        log.error('Failed to archive task:', error as any);

        // Restore task to UI on error
        let restored = false;
        try {
          const refreshedTasks = await window.electronAPI.getTasks(targetProject.id);
          setProjects((prev) =>
            prev.map((project) =>
              project.id === targetProject.id ? { ...project, tasks: refreshedTasks } : project
            )
          );
          setSelectedProject((prev) =>
            prev && prev.id === targetProject.id ? { ...prev, tasks: refreshedTasks } : prev
          );

          if (wasActive) {
            const restoredTask = refreshedTasks.find((t) => t.id === task.id);
            if (restoredTask) {
              handleSelectTask(restoredTask);
            }
          }
          restored = true;
        } catch (refreshError) {
          log.error('Failed to refresh tasks after archive failure:', refreshError as any);
        }

        // Fallback: manually restore task if refresh failed
        if (!restored) {
          setProjects((prev) =>
            prev.map((project) =>
              project.id === targetProject.id
                ? { ...project, tasks: [...(project.tasks || []), taskSnapshot] }
                : project
            )
          );
          setSelectedProject((prev) =>
            prev && prev.id === targetProject.id
              ? { ...prev, tasks: [...(prev.tasks || []), taskSnapshot] }
              : prev
          );
          if (wasActive) {
            handleSelectTask(taskSnapshot);
          }
        }

        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Could not archive task.',
          variant: 'destructive',
        });

        return false;
      }
    } finally {
      archivingTaskIdsRef.current.delete(task.id);
    }
  };

  const handleRestoreTask = async (targetProject: Project, task: Task): Promise<void> => {
    if (restoringTaskIdsRef.current.has(task.id)) {
      return;
    }

    restoringTaskIdsRef.current.add(task.id);

    try {
      const result = await window.electronAPI.restoreTask(task.id);

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to restore task');
      }

      // Refresh tasks to include the restored task
      let refreshed = false;
      try {
        const refreshedTasks = await window.electronAPI.getTasks(targetProject.id);
        setProjects((prev) =>
          prev.map((project) =>
            project.id === targetProject.id ? { ...project, tasks: refreshedTasks } : project
          )
        );
        setSelectedProject((prev) =>
          prev && prev.id === targetProject.id ? { ...prev, tasks: refreshedTasks } : prev
        );
        refreshed = true;
      } catch (refreshError) {
        const { log } = await import('../lib/logger');
        log.error('Failed to refresh tasks after restore:', refreshError as any);
      }

      // Fallback: manually add task to active list if refresh failed (prepend to match sort order)
      if (!refreshed) {
        const restoredTask = { ...task, archivedAt: null };
        setProjects((prev) =>
          prev.map((project) =>
            project.id === targetProject.id
              ? { ...project, tasks: [restoredTask, ...(project.tasks || [])] }
              : project
          )
        );
        setSelectedProject((prev) =>
          prev && prev.id === targetProject.id
            ? { ...prev, tasks: [restoredTask, ...(prev.tasks || [])] }
            : prev
        );
      }

      // Track task restore
      const { captureTelemetry } = await import('../lib/telemetryClient');
      captureTelemetry('task_restored');

      toast({
        title: 'Task restored',
        description: task.name,
      });
    } catch (error) {
      const { log } = await import('../lib/logger');
      log.error('Failed to restore task:', error as any);

      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Could not restore task.',
        variant: 'destructive',
      });
    } finally {
      restoringTaskIdsRef.current.delete(task.id);
    }
  };

  return {
    activeTask,
    setActiveTask,
    activeTaskAgent,
    setActiveTaskAgent,
    archivedTasksVersion,
    allTasks,
    linkedGithubIssueMap,
    handleSelectTask,
    handleNextTask,
    handlePrevTask,
    handleNewTask,
    handleStartCreateTaskFromSidebar,
    removeTaskFromState,
    handleDeleteTask,
    handleRenameTask,
    handleArchiveTask,
    handleRestoreTask,
  };
}
