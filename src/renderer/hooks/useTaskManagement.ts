import { useState, useMemo, useCallback, useRef } from 'react';
import { TERMINAL_PROVIDER_IDS } from '../constants/agents';
import { makePtyId } from '@shared/ptyId';
import type { ProviderId } from '@shared/providers/registry';
import { saveActiveIds, getStoredActiveIds } from '../constants/layout';
import { getAgentForTask } from '../lib/getAgentForTask';
import { disposeTaskTerminals } from '../lib/taskTerminalsStore';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import type { Agent } from '../types';
import type { Project, Task } from '../types/app';
import type { GitHubIssueLink } from '../types/chat';
import { rpc } from '../lib/rpc';

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

interface UseTaskManagementOptions {
  projects: Project[];
  selectedProject: Project | null;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setSelectedProject: React.Dispatch<React.SetStateAction<Project | null>>;
  setShowHomeView: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSkillsView: React.Dispatch<React.SetStateAction<boolean>>;
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
    setShowSkillsView,
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
    setShowKanban(false);
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
    setShowSkillsView(false);
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
    setShowSkillsView(false);
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
    const lifecycleTargets = getLifecycleTargets(task);
    const issues: string[] = [];

    await Promise.allSettled(
      lifecycleTargets.map((target) =>
        window.electronAPI.lifecycleRunStop({ taskId: target.taskId })
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
        // Single-agent: makePtyId(provider, 'main', task.id)
        // Multi-agent: ${variant.worktreeId}-main (different format, not provider-prefixed)
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
            const id = makePtyId(provider, 'main', task.id);
            mainSessionIds.push(id);
            try {
              window.electronAPI.ptyKill?.(id);
            } catch {}
          }
        }

        // Kill chat agent terminals (agents added via "+")
        const chatSessionIds: string[] = [];
        try {
          const conversations = await rpc.db.getConversations(task.id);
          for (const conv of conversations) {
            if (!conv.isMain && conv.provider) {
              const chatId = makePtyId(conv.provider as ProviderId, 'chat', conv.id);
              chatSessionIds.push(chatId);
              try {
                window.electronAPI.ptyKill?.(chatId);
              } catch {}
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

        const promises: Promise<any>[] = [rpc.db.deleteTask(task.id)];

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
        if (deleteResult.status !== 'fulfilled') {
          throw new Error(
            deleteResult.reason?.message || String(deleteResult.reason) || 'Failed to delete task'
          );
        }

        for (const lifecycleTaskId of getLifecycleTaskIds(task)) {
          try {
            await window.electronAPI.lifecycleClearTask({ taskId: lifecycleTaskId });
          } catch {}
        }

        // Track task deletion
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('task_deleted');

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
          const refreshedTasks = (await rpc.db.getTasks(targetProject.id)) as Task[];
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

    // Helper to update task name, branch, and clear nameGenerated across all state locations
    const applyTaskChange = (name: string, branch: string, clearNameGenerated = false) => {
      const updateTasks = (tasks: Task[] | undefined) =>
        tasks?.map((t) => {
          if (t.id !== task.id) return t;
          const updated = { ...t, name, branch };
          if (clearNameGenerated && updated.metadata?.nameGenerated) {
            updated.metadata = { ...updated.metadata, nameGenerated: null };
          }
          return updated;
        });

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
      setActiveTask((prev) => {
        if (prev?.id !== task.id) return prev;
        const updated = { ...prev, name, branch };
        if (clearNameGenerated && updated.metadata?.nameGenerated) {
          updated.metadata = { ...updated.metadata, nameGenerated: null };
        }
        return updated;
      });
    };

    // Optimistically update local state (clear nameGenerated to prevent re-triggering)
    applyTaskChange(newName, newBranch, true);

    let branchRenamed = false;
    try {
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
      }

      // Save task with new name, branch, and clear nameGenerated flag
      const updatedMetadata = task.metadata?.nameGenerated
        ? { ...task.metadata, nameGenerated: null }
        : task.metadata;
      const saveResult = await rpc.db.saveTask({
        ...task,
        name: newName,
        branch: newBranch,
        metadata: updatedMetadata,
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
              const id = makePtyId(provider, 'main', task.id);
              mainSessionIds.push(id);
              try {
                window.electronAPI.ptyKill?.(id);
              } catch {}
            }
          }

          // Kill chat agent terminals
          const chatSessionIds: string[] = [];
          try {
            const conversations = await rpc.db.getConversations(task.id);
            for (const conv of conversations) {
              if (!conv.isMain && conv.provider) {
                const chatId = makePtyId(conv.provider as ProviderId, 'chat', conv.id);
                chatSessionIds.push(chatId);
                try {
                  window.electronAPI.ptyKill?.(chatId);
                } catch {}
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
        await rpc.db.archiveTask(task.id);

        for (const lifecycleTaskId of getLifecycleTaskIds(task)) {
          try {
            await window.electronAPI.lifecycleClearTask({ taskId: lifecycleTaskId });
          } catch {}
        }

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
          const refreshedTasks = (await rpc.db.getTasks(targetProject.id)) as Task[];
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
      await rpc.db.restoreTask(task.id);

      // Refresh tasks to include the restored task
      let refreshed = false;
      let restoredTaskForSetup: Task | null = null;
      try {
        const refreshedTasks = (await rpc.db.getTasks(targetProject.id)) as Task[];
        setProjects((prev) =>
          prev.map((project) =>
            project.id === targetProject.id ? { ...project, tasks: refreshedTasks } : project
          )
        );
        setSelectedProject((prev) =>
          prev && prev.id === targetProject.id ? { ...prev, tasks: refreshedTasks } : prev
        );
        restoredTaskForSetup = refreshedTasks.find((t) => t.id === task.id) || null;
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
        restoredTaskForSetup = restoredTask;
      }

      if (restoredTaskForSetup) {
        try {
          await runSetupForTask(restoredTaskForSetup, targetProject.path);
        } catch {}
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
