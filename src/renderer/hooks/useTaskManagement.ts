import { useCallback, useRef, useState } from 'react';
import type { Provider } from '../types';
import { TERMINAL_PROVIDER_IDS } from '../constants/providers';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import type { Project, Task } from '../types/app';
import { useToast } from './use-toast';

/**
 * Hook to manage task state and operations
 * Handles task CRUD, selection, and terminal management
 */

export interface TaskManagementState {
  activeTask: Task | null;
  activeTaskProvider: Provider | null;
  isCreatingTask: boolean;
}

export interface TaskManagementActions {
  setActiveTask: (task: Task | null) => void;
  setActiveTaskProvider: (provider: Provider | null) => void;
  handleSelectTask: (task: Task) => void;
  handleDeleteTask: (targetProject: Project, task: Task, options?: { silent?: boolean }) => Promise<boolean>;
  handleRenameTask: (targetProject: Project, task: Task, newName: string) => Promise<void>;
  handleNextTask: () => void;
  handlePrevTask: () => void;
  setIsCreatingTask: (creating: boolean) => void;
}

interface UseTaskManagementOptions {
  projects: Project[];
  selectedProject: Project | null;
  activateProjectView?: (project: Project) => void;
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setSelectedProject: React.Dispatch<React.SetStateAction<Project | null>>;
}

export function useTaskManagement(
  options: UseTaskManagementOptions
): TaskManagementState & TaskManagementActions {
  const {
    projects,
    selectedProject,
    activateProjectView,
    setProjects,
    setSelectedProject,
  } = options;

  const { toast } = useToast();

  // Task state
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskProvider, setActiveTaskProvider] = useState<Provider | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState<boolean>(false);

  // Ref to track in-progress deletions
  const deletingTaskIdsRef = useRef<Set<string>>(new Set());

  // Select task handler
  const handleSelectTask = useCallback((task: Task) => {
    setActiveTask(task);
    // Load provider from task.agentId if it exists, otherwise default to null
    // This ensures the selected provider persists across app restarts
    if ((task.metadata as any)?.multiAgent?.enabled) {
      setActiveTaskProvider(null);
    } else {
      // Use agentId from task if available, otherwise fall back to 'codex' for backwards compatibility
      setActiveTaskProvider((task.agentId as Provider) || 'codex');
    }
  }, []);

  // Remove task from state
  const removeTaskFromState = useCallback(
    (projectId: string, taskId: string, wasActive: boolean) => {
      const filterTasks = (list?: Task[]) => (list || []).filter((w) => w.id !== taskId);

      setProjects((prev) =>
        prev.map((project) =>
          project.id === projectId ? { ...project, tasks: filterTasks(project.tasks) } : project
        )
      );

      setSelectedProject((prev) =>
        prev && prev.id === projectId ? { ...prev, tasks: filterTasks(prev.tasks) } : prev
      );

      if (wasActive) {
        setActiveTask(null);
        setActiveTaskProvider(null);
      }
    },
    [setProjects, setSelectedProject]
  );

  // Delete task handler
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

      const wasActive = activeTask?.id === task.id;
      const taskSnapshot = { ...task };
      deletingTaskIdsRef.current.add(task.id);
      removeTaskFromState(targetProject.id, task.id, wasActive);

      const runDeletion = async (): Promise<boolean> => {
        try {
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

          // Kill PTY sessions
          try {
            window.electronAPI.ptyKill?.(`task-${task.id}`);
          } catch {}
          try {
            for (const provider of TERMINAL_PROVIDER_IDS) {
              try {
                window.electronAPI.ptyKill?.(`${provider}-main-${task.id}`);
              } catch {}
            }
          } catch {}

          const sessionIds = [
            `task-${task.id}`,
            ...TERMINAL_PROVIDER_IDS.map((provider) => `${provider}-main-${task.id}`),
          ];

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
    },
    [activeTask, setProjects, setSelectedProject, removeTaskFromState, handleSelectTask, toast]
  );

  // Rename task handler
  const handleRenameTask = useCallback(
    async (targetProject: Project, task: Task, newName: string) => {
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
    },
    [setProjects, setSelectedProject, toast]
  );

  // Get all tasks across projects for cycling
  const getAllTasks = useCallback(() => {
    const tasks: { task: Task; project: Project }[] = [];
    for (const project of projects) {
      for (const task of project.tasks || []) {
        tasks.push({ task, project });
      }
    }
    return tasks;
  }, [projects]);

  // Navigate to next task
  const handleNextTask = useCallback(() => {
    const allTasks = getAllTasks();
    if (allTasks.length === 0) return;

    const currentIndex = activeTask
      ? allTasks.findIndex((t: { task: Task; project: Project }) => t.task.id === activeTask.id)
      : -1;
    const nextIndex = (currentIndex + 1) % allTasks.length;
    const { task, project } = allTasks[nextIndex];

    activateProjectView?.(project);
    setActiveTask(task);
    if ((task.metadata as any)?.multiAgent?.enabled) {
      setActiveTaskProvider(null);
    } else {
      setActiveTaskProvider((task.agentId as Provider) || 'codex');
    }
  }, [getAllTasks, activeTask, activateProjectView]);

  // Navigate to previous task
  const handlePrevTask = useCallback(() => {
    const allTasks = getAllTasks();
    if (allTasks.length === 0) return;

    const currentIndex = activeTask
      ? allTasks.findIndex((t: { task: Task; project: Project }) => t.task.id === activeTask.id)
      : -1;
    const prevIndex = currentIndex <= 0 ? allTasks.length - 1 : currentIndex - 1;
    const { task, project } = allTasks[prevIndex];

    activateProjectView?.(project);
    setActiveTask(task);
    if ((task.metadata as any)?.multiAgent?.enabled) {
      setActiveTaskProvider(null);
    } else {
      setActiveTaskProvider((task.agentId as Provider) || 'codex');
    }
  }, [getAllTasks, activeTask, activateProjectView]);

  return {
    // State
    activeTask,
    activeTaskProvider,
    isCreatingTask,

    // Actions
    setActiveTask,
    setActiveTaskProvider,
    handleSelectTask,
    handleDeleteTask,
    handleRenameTask,
    handleNextTask,
    handlePrevTask,
    setIsCreatingTask,
  };
}