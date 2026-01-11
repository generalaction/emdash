import { useCallback, useEffect, useMemo, useState, Dispatch, SetStateAction } from 'react';
import type { Project, Task } from '../types/app';
import type { Provider } from '../types';

const FIRST_LAUNCH_KEY = 'emdash:first-launch:v1';

export interface AppNavigationState {
  activeTask: Task | null;
  setActiveTask: (task: Task | null) => void;
  activeTaskProvider: Provider | null;
  setActiveTaskProvider: (provider: Provider | null) => void;
  isCreatingTask: boolean;
  setIsCreatingTask: (creating: boolean) => void;
}

export interface AppNavigationHandlers {
  handleSelectTask: (task: Task) => void;
  handleStartCreateTaskFromSidebar: (project: Project) => void;
  handleCreateTask: (
    name: string,
    initialPrompt?: string,
    providerRuns?: any[],
    linkedLinearIssue?: any,
    linkedGithubIssue?: any,
    linkedJiraIssue?: any,
    autoApprove?: boolean,
    useWorktree?: boolean
  ) => Promise<void>;
  handleNextTask: () => void;
  handlePrevTask: () => void;
  handleNewTask: () => void;
  markFirstLaunchSeen: () => void;
  allTasks: { task: Task; project: Project }[];
}

export function useAppNavigation(
  projects: Project[],
  selectedProject: Project | null,
  setSelectedProject: Dispatch<SetStateAction<Project | null>>,
  setShowHomeView: (show: boolean) => void,
  setProjects: Dispatch<SetStateAction<Project[]>>
): AppNavigationState & AppNavigationHandlers {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskProvider, setActiveTaskProvider] = useState<Provider | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);

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

  const handleSelectTask = useCallback(
    (task: Task) => {
      if (!selectedProject) return;
      setActiveTask(task);
      if ((task.metadata as any)?.multiAgent?.enabled) {
        setActiveTaskProvider(null);
      } else {
        setActiveTaskProvider((task.agentId as Provider) || 'codex');
      }
    },
    [selectedProject]
  );

  const handleStartCreateTaskFromSidebar = useCallback(
    (project: Project) => {
      setSelectedProject(project);
      setShowHomeView(false);
      setActiveTask(null);
      setIsCreatingTask(true);
    },
    [setSelectedProject, setShowHomeView]
  );

  const handleCreateTask = useCallback(
    async (
      name: string,
      initialPrompt?: string,
      providerRuns?: any[],
      linkedLinearIssue?: any,
      linkedGithubIssue?: any,
      linkedJiraIssue?: any,
      autoApprove?: boolean,
      useWorktree?: boolean
    ) => {
      const { log } = await import('../lib/logger');
      if (!selectedProject) {
        throw new Error('No project selected');
      }

      try {
        const res = await (window.electronAPI as any).createTask?.({
          projectId: selectedProject.id,
          name,
          initialPrompt,
          providerRuns,
          linkedLinearIssue,
          linkedGithubIssue,
          linkedJiraIssue,
          autoApprove,
          useWorktree,
        });

        if (!res?.success) {
          throw new Error(res?.error || 'Failed to create task');
        }

        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('task_created');

        const createdTask: Task = res.task;

        setProjects((prev) =>
          prev.map((project) => {
            if (project.id !== selectedProject.id) return project;
            return { ...project, tasks: [createdTask, ...(project.tasks || [])] };
          })
        );

        setSelectedProject((prev) => {
          if (!prev || prev.id !== selectedProject.id) return prev;
          return { ...prev, tasks: [createdTask, ...(prev.tasks || [])] };
        });

        handleSelectTask(createdTask);
      } catch (error) {
        log.error('Create task error:', error as any);
        throw error;
      }
    },
    [selectedProject, setProjects, setSelectedProject, handleSelectTask]
  );

  const handleNextTask = useCallback(() => {
    if (allTasks.length === 0) return;
    const currentIndex = activeTask
      ? allTasks.findIndex((t: { task: Task; project: Project }) => t.task.id === activeTask.id)
      : -1;
    const nextIndex = (currentIndex + 1) % allTasks.length;
    const { task, project } = allTasks[nextIndex];
    setSelectedProject(project);
    setShowHomeView(false);
    setActiveTask(task);
    if ((task.metadata as any)?.multiAgent?.enabled) {
      setActiveTaskProvider(null);
    } else {
      setActiveTaskProvider((task.agentId as Provider) || 'codex');
    }
  }, [allTasks, activeTask, setSelectedProject, setShowHomeView]);

  const handlePrevTask = useCallback(() => {
    if (allTasks.length === 0) return;
    const currentIndex = activeTask
      ? allTasks.findIndex((t: { task: Task; project: Project }) => t.task.id === activeTask.id)
      : -1;
    const prevIndex = currentIndex <= 0 ? allTasks.length - 1 : currentIndex - 1;
    const { task, project } = allTasks[prevIndex];
    setSelectedProject(project);
    setShowHomeView(false);
    setActiveTask(task);
    if ((task.metadata as any)?.multiAgent?.enabled) {
      setActiveTaskProvider(null);
    } else {
      setActiveTaskProvider((task.agentId as Provider) || 'codex');
    }
  }, [allTasks, activeTask, setSelectedProject, setShowHomeView]);

  const handleNewTask = useCallback(() => {
    // Only allow if a project is selected
    if (selectedProject) {
      setIsCreatingTask(true);
    }
  }, [selectedProject]);

  const markFirstLaunchSeen = useCallback(() => {
    try {
      localStorage.setItem(FIRST_LAUNCH_KEY, '1');
    } catch {
      // ignore
    }
    try {
      void window.electronAPI.setOnboardingSeen?.(true);
    } catch {
      // ignore
    }
  }, []);

  // Check if first launch on mount
  useEffect(() => {
    const check = async () => {
      let seenLocal = false;
      try {
        seenLocal = localStorage.getItem(FIRST_LAUNCH_KEY) === '1';
      } catch {
        // ignore
      }
      if (seenLocal) return;

      try {
        const res = await window.electronAPI.getTelemetryStatus?.();
        if (res?.success && res.status?.onboardingSeen) return;
      } catch {
        // ignore
      }
      setShowHomeView(true);
    };
    void check();
  }, [setShowHomeView]);

  return {
    activeTask,
    setActiveTask,
    activeTaskProvider,
    setActiveTaskProvider,
    isCreatingTask,
    setIsCreatingTask,
    handleSelectTask,
    handleStartCreateTaskFromSidebar,
    handleCreateTask,
    handleNextTask,
    handlePrevTask,
    handleNewTask,
    markFirstLaunchSeen,
    allTasks,
  };
}
