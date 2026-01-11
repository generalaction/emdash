import { useCallback, useMemo, useRef, useState } from 'react';
import type { Project, Task } from '../types/app';
import { useToast } from './use-toast';
import {
  computeBaseRef,
  getProjectRepoKey,
  normalizePathForComparison,
  withRepoKey,
} from '../lib/projectUtils';

const ORDER_KEY = 'sidebarProjectOrder';

export interface ProjectOperationsHandlers {
  handleOpenProject: () => void;
  handleNewProjectClick: () => void;
  handleCloneProjectClick: () => void;
  handleSelectProject: (project: Project) => void;
  handleGoHome: () => void;
  handleDeleteTask: (
    project: Project,
    task: Task,
    options?: { silent?: boolean }
  ) => void | Promise<void | boolean>;
  handleReorderProjects: (sourceId: string, targetId: string) => void;
  handleReorderProjectsFull: (newOrder: Project[]) => void;
  handleDeleteProject: (project: Project) => Promise<void>;
  handleCloneSuccess: (projectPath: string) => Promise<void>;
  handleNewProjectSuccess: (projectPath: string) => Promise<void>;
  activateProjectView: (project: Project) => void;
  saveProjectOrder: (projects: Project[]) => void;
  applyProjectOrder: (list: Project[]) => Project[];
}

export function useProjectOperations(
  projects: Project[],
  setProjects: (projects: Project[]) => void,
  platform: string,
  isAuthenticated: boolean,
  ghInstalled: boolean,
  selectedProject: Project | null,
  setSelectedProject: (project: Project | null) => void,
  activateProjectViewFn: (project: Project) => void,
  setShowNewProjectModal: (show: boolean) => void,
  setShowCloneModal: (show: boolean) => void,
  setShowHomeView: (show: boolean) => void,
  setActiveTask: (task: Task | null) => void
): ProjectOperationsHandlers {
  const { toast } = useToast();
  const deletingTaskIdsRef = useRef<Set<string>>(new Set());

  const saveProjectOrder = useCallback((projects: Project[]) => {
    try {
      const order = projects.map((p) => p.id);
      localStorage.setItem(ORDER_KEY, JSON.stringify(order));
    } catch {
      // ignore storage errors
    }
  }, []);

  const applyProjectOrder = useCallback((list: Project[]) => {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (!raw) return list;
      const order: string[] = JSON.parse(raw);
      const ordered = order
        .map((id) => list.find((p) => p.id === id))
        .filter((p) => p !== undefined) as Project[];
      const unordered = list.filter((p) => !order.includes(p.id));
      return [...ordered, ...unordered];
    } catch {
      return list;
    }
  }, []);

  const handleOpenProject = useCallback(async () => {
    const { captureTelemetry } = await import('../lib/telemetryClient');
    captureTelemetry('project_open_clicked');

    try {
      const result = (await (window as any).electronAPI?.openFolder?.()) as any;
      if (result?.path) {
        try {
          const gitInfo = await window.electronAPI.getGitInfo(result.path);
          const canonicalPath = gitInfo.rootPath || gitInfo.path || result.path;
          const repoKey = normalizePathForComparison(canonicalPath, platform);
          const existingProject = projects.find(
            (project) => getProjectRepoKey(project, platform) === repoKey
          );

          if (existingProject) {
            activateProjectViewFn(existingProject);
            return;
          }

          const remoteUrl = gitInfo.remote || '';
          const isGithubRemote = /github\.com[:/]/i.test(remoteUrl);
          const projectName =
            canonicalPath.split(/[/\\]/).filter(Boolean).pop() || 'Unknown Project';

          const baseProject: Project = {
            id: Date.now().toString(),
            name: projectName,
            path: canonicalPath,
            repoKey,
            gitInfo: {
              isGitRepo: true,
              remote: gitInfo.remote || undefined,
              branch: gitInfo.branch || undefined,
              baseRef: computeBaseRef(gitInfo.baseRef, gitInfo.remote, gitInfo.branch),
            },
            tasks: [],
          };

          if (isAuthenticated && isGithubRemote) {
            const githubInfo = await window.electronAPI.connectToGitHub(canonicalPath);
            if (githubInfo.success) {
              const projectWithGithub = withRepoKey(
                {
                  ...baseProject,
                  githubInfo: {
                    repository: githubInfo.repository || '',
                    connected: true,
                  },
                },
                platform
              );

              const saveResult = await window.electronAPI.saveProject(projectWithGithub);
              if (saveResult.success) {
                captureTelemetry('project_open_success');
                setProjects([...projects, projectWithGithub]);
                activateProjectViewFn(projectWithGithub);
              } else {
                const { log } = await import('../lib/logger');
                log.error('Failed to save project:', saveResult.error);
              }
            }
          } else {
            const projectWithoutGithub = withRepoKey(
              {
                ...baseProject,
                githubInfo: {
                  repository: '',
                  connected: false,
                },
              },
              platform
            );

            const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
            if (saveResult.success) {
              captureTelemetry('project_open_success');
              setProjects([...projects, projectWithoutGithub]);
              activateProjectViewFn(projectWithoutGithub);
            }
          }
        } catch (error) {
          const { log } = await import('../lib/logger');
          log.error('Git detection error:', error as any);
          toast({
            title: 'Project Opened',
            description: `Could not detect Git information. Path: ${result.path}`,
            variant: 'destructive',
          });
        }
      } else if (result?.error) {
        if (result.error === 'No directory selected') return;
        toast({
          title: 'Failed to Open Project',
          description: result.error,
          variant: 'destructive',
        });
      }
    } catch (error) {
      const { log } = await import('../lib/logger');
      log.error('Open project error:', error as any);
      toast({
        title: 'Failed to Open Project',
        description: 'Please check the console for details.',
        variant: 'destructive',
      });
    }
  }, [projects, isAuthenticated, platform, activateProjectViewFn, setProjects, toast]);

  const handleNewProjectClick = useCallback(async () => {
    const { captureTelemetry } = await import('../lib/telemetryClient');
    captureTelemetry('project_create_clicked');

    if (!isAuthenticated || !ghInstalled) {
      toast({
        title: 'GitHub authentication required',
        variant: 'destructive',
      });
      return;
    }

    setShowNewProjectModal(true);
  }, [isAuthenticated, ghInstalled, toast, setShowNewProjectModal]);

  const handleCloneProjectClick = useCallback(async () => {
    const { captureTelemetry } = await import('../lib/telemetryClient');
    captureTelemetry('project_clone_clicked');

    if (!isAuthenticated || !ghInstalled) {
      toast({
        title: 'GitHub authentication required',
        variant: 'destructive',
      });
      return;
    }

    setShowCloneModal(true);
  }, [isAuthenticated, ghInstalled, toast, setShowCloneModal]);

  const handleCloneSuccess = useCallback(
    async (projectPath: string) => {
      const { captureTelemetry } = await import('../lib/telemetryClient');
      captureTelemetry('project_cloned');
      try {
        const gitInfo = await window.electronAPI.getGitInfo(projectPath);
        const canonicalPath = gitInfo.rootPath || gitInfo.path || projectPath;
        const repoKey = normalizePathForComparison(canonicalPath, platform);
        const existingProject = projects.find(
          (project) => getProjectRepoKey(project, platform) === repoKey
        );

        if (existingProject) {
          activateProjectViewFn(existingProject);
          return;
        }

        const remoteUrl = gitInfo.remote || '';
        const isGithubRemote = /github\.com[:/]/i.test(remoteUrl);
        const projectName = canonicalPath.split(/[/\\]/).filter(Boolean).pop() || 'Unknown Project';

        const baseProject: Project = {
          id: Date.now().toString(),
          name: projectName,
          path: canonicalPath,
          repoKey,
          gitInfo: {
            isGitRepo: true,
            remote: gitInfo.remote || undefined,
            branch: gitInfo.branch || undefined,
            baseRef: computeBaseRef(gitInfo.baseRef, gitInfo.remote, gitInfo.branch),
          },
          tasks: [],
        };

        if (isAuthenticated && isGithubRemote) {
          const githubInfo = await window.electronAPI.connectToGitHub(canonicalPath);
          if (githubInfo.success) {
            const projectWithGithub = withRepoKey(
              {
                ...baseProject,
                githubInfo: {
                  repository: githubInfo.repository || '',
                  connected: true,
                },
              },
              platform
            );

            const saveResult = await window.electronAPI.saveProject(projectWithGithub);
            if (saveResult.success) {
              captureTelemetry('project_clone_success');
              captureTelemetry('project_added_success', { source: 'clone' });
              setProjects((prev) => [...prev, projectWithGithub]);
              activateProjectViewFn(projectWithGithub);
            } else {
              const { log } = await import('../lib/logger');
              log.error('Failed to save project:', saveResult.error);
              toast({
                title: 'Project Cloned',
                description: 'Repository cloned but failed to save to database.',
                variant: 'destructive',
              });
            }
          } else {
            const projectWithoutGithub = withRepoKey(
              {
                ...baseProject,
                githubInfo: {
                  repository: '',
                  connected: false,
                },
              },
              platform
            );

            const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
            if (saveResult.success) {
              captureTelemetry('project_clone_success');
              captureTelemetry('project_added_success', { source: 'clone' });
              setProjects((prev) => [...prev, projectWithoutGithub]);
              activateProjectViewFn(projectWithoutGithub);
            }
          }
        } else {
          const projectWithoutGithub = withRepoKey(
            {
              ...baseProject,
              githubInfo: {
                repository: '',
                connected: false,
              },
            },
            platform
          );

          const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
          if (saveResult.success) {
            captureTelemetry('project_clone_success');
            captureTelemetry('project_added_success', { source: 'clone' });
            setProjects((prev) => [...prev, projectWithoutGithub]);
            activateProjectViewFn(projectWithoutGithub);
          }
        }
      } catch (error) {
        const { log } = await import('../lib/logger');
        log.error('Failed to load cloned project:', error);
        toast({
          title: 'Project Cloned',
          description: 'Repository cloned but failed to load. Please try opening it manually.',
          variant: 'destructive',
        });
      }
    },
    [projects, isAuthenticated, activateProjectViewFn, platform, setProjects, toast]
  );

  const handleNewProjectSuccess = useCallback(
    async (projectPath: string) => {
      const { captureTelemetry } = await import('../lib/telemetryClient');
      captureTelemetry('new_project_created');
      try {
        const gitInfo = await window.electronAPI.getGitInfo(projectPath);
        const canonicalPath = gitInfo.rootPath || gitInfo.path || projectPath;
        const repoKey = normalizePathForComparison(canonicalPath, platform);
        const existingProject = projects.find(
          (project) => getProjectRepoKey(project, platform) === repoKey
        );

        if (existingProject) {
          activateProjectViewFn(existingProject);
          return;
        }

        const remoteUrl = gitInfo.remote || '';
        const isGithubRemote = /github\.com[:/]/i.test(remoteUrl);
        const projectName = canonicalPath.split(/[/\\]/).filter(Boolean).pop() || 'Unknown Project';

        const baseProject: Project = {
          id: Date.now().toString(),
          name: projectName,
          path: canonicalPath,
          repoKey,
          gitInfo: {
            isGitRepo: true,
            remote: gitInfo.remote || undefined,
            branch: gitInfo.branch || undefined,
            baseRef: computeBaseRef(gitInfo.baseRef, gitInfo.remote, gitInfo.branch),
          },
          tasks: [],
        };

        if (isAuthenticated && isGithubRemote) {
          const githubInfo = await window.electronAPI.connectToGitHub(canonicalPath);
          if (githubInfo.success) {
            const projectWithGithub = withRepoKey(
              {
                ...baseProject,
                githubInfo: {
                  repository: githubInfo.repository || '',
                  connected: true,
                },
              },
              platform
            );

            const saveResult = await window.electronAPI.saveProject(projectWithGithub);
            if (saveResult.success) {
              captureTelemetry('project_create_success');
              captureTelemetry('project_added_success', { source: 'new_project' });
              toast({
                title: 'Project created successfully!',
                description: `${projectWithGithub.name} has been added to your projects.`,
              });
              setProjects((prev) => [...prev, projectWithGithub]);
              activateProjectViewFn(projectWithGithub);
            } else {
              const { log } = await import('../lib/logger');
              log.error('Failed to save project:', saveResult.error);
            }
          } else {
            const projectWithoutGithub = withRepoKey(
              {
                ...baseProject,
                githubInfo: {
                  repository: '',
                  connected: false,
                },
              },
              platform
            );

            const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
            if (saveResult.success) {
              captureTelemetry('project_create_success');
              captureTelemetry('project_added_success', { source: 'new_project' });
              toast({
                title: 'Project created successfully!',
                description: `${projectWithoutGithub.name} has been added to your projects.`,
              });
              setProjects((prev) => [...prev, projectWithoutGithub]);
              activateProjectViewFn(projectWithoutGithub);
            }
          }
        } else {
          const projectWithoutGithub = withRepoKey(
            {
              ...baseProject,
              githubInfo: {
                repository: '',
                connected: false,
              },
            },
            platform
          );

          const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
          if (saveResult.success) {
            captureTelemetry('project_create_success');
            captureTelemetry('project_added_success', { source: 'new_project' });
            toast({
              title: 'Project created successfully!',
              description: `${projectWithoutGithub.name} has been added to your projects.`,
            });
            setProjects((prev) => [...prev, projectWithoutGithub]);
            activateProjectViewFn(projectWithoutGithub);
          }
        }
      } catch (error) {
        const { log } = await import('../lib/logger');
        log.error('Failed to create project:', error);
        toast({
          title: 'Failed to Create Project',
          description: error instanceof Error ? error.message : String(error),
          variant: 'destructive',
        });
      }
    },
    [projects, isAuthenticated, activateProjectViewFn, platform, setProjects, toast]
  );

  const handleSelectProject = useCallback(
    (project: Project) => {
      activateProjectViewFn(project);
    },
    [activateProjectViewFn]
  );

  const handleGoHome = useCallback(() => {
    setShowHomeView(true);
    setSelectedProject(null);
    setActiveTask(null);
  }, [setShowHomeView, setSelectedProject, setActiveTask]);

  const activateProjectView = useCallback(
    (project: Project) => {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('project_view_opened');
      })();
      setSelectedProject(project);
      setShowHomeView(false);
      setActiveTask(null);
    },
    [setSelectedProject, setShowHomeView, setActiveTask]
  );

  const handleDeleteTask = useCallback(
    async (project: Project, task: Task, options?: { silent?: boolean }) => {
      const { log } = await import('../lib/logger');

      if (deletingTaskIdsRef.current.has(task.id)) {
        return false;
      }

      deletingTaskIdsRef.current.add(task.id);

      const wasActive =
        selectedProject?.id === project.id && task.id === (selectedProject as any).activeTask?.id;
      const taskSnapshot = { ...task };

      const runDeletion = async () => {
        try {
          const res = await window.electronAPI.deleteTask(task.id);
          if (!res?.success) {
            throw new Error(res?.error || 'Failed to delete task');
          }

          const { captureTelemetry } = await import('../lib/telemetryClient');
          captureTelemetry('task_deleted');

          setProjects((prev) =>
            prev.map((p) => {
              if (p.id !== project.id) return p;
              return { ...p, tasks: (p.tasks || []).filter((w) => w.id !== task.id) };
            })
          );

          setSelectedProject((prev) => {
            if (!prev || prev.id !== project.id) return prev;
            return { ...prev, tasks: (prev.tasks || []).filter((w) => w.id !== task.id) };
          });

          if (wasActive) {
            setActiveTask(null);
          }

          if (!options?.silent) {
            toast({
              title: 'Task deleted',
              description: `"${task.name}" was removed.`,
            });
          }
          return true;
        } catch (error) {
          log.error('Delete task failed:', error as any);

          try {
            const targetProject = projects.find((p) => p.id === project.id) || project;
            const refreshedTasks = await window.electronAPI.getTasks(targetProject.id);
            setProjects((prev) =>
              prev.map((p) => (p.id === targetProject.id ? { ...p, tasks: refreshedTasks } : p))
            );
            setSelectedProject((prev) =>
              prev && prev.id === targetProject.id ? { ...prev, tasks: refreshedTasks } : prev
            );

            if (wasActive) {
              const restored = refreshedTasks.find((w) => w.id === task.id);
              if (restored) {
                setActiveTask(restored);
              }
            }
          } catch (refreshError) {
            log.error('Failed to refresh tasks after delete failure:', refreshError as any);

            setProjects((prev) =>
              prev.map((p) => {
                if (p.id !== project.id) return p;
                const existing = p.tasks || [];
                const alreadyPresent = existing.some((w) => w.id === taskSnapshot.id);
                return alreadyPresent ? p : { ...p, tasks: [taskSnapshot, ...existing] };
              })
            );
            setSelectedProject((prev) => {
              if (!prev || prev.id !== project.id) return prev;
              const existing = prev.tasks || [];
              const alreadyPresent = existing.some((w) => w.id === taskSnapshot.id);
              return alreadyPresent ? prev : { ...prev, tasks: [taskSnapshot, ...existing] };
            });

            if (wasActive) {
              setActiveTask(taskSnapshot);
            }
          }
          return false;
        } finally {
          deletingTaskIdsRef.current.delete(task.id);
        }
      };

      return runDeletion();
    },
    [selectedProject, setProjects, setSelectedProject, setActiveTask, projects, toast]
  );

  const handleReorderProjects = useCallback(
    (sourceId: string, targetId: string) => {
      setProjects((prev) => {
        const list = [...prev];
        const fromIdx = list.findIndex((p) => p.id === sourceId);
        const toIdx = list.findIndex((p) => p.id === targetId);
        if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
        const [moved] = list.splice(fromIdx, 1);
        list.splice(toIdx, 0, moved);
        saveProjectOrder(list);
        return list;
      });
    },
    [setProjects, saveProjectOrder]
  );

  const handleReorderProjectsFull = useCallback(
    (newOrder: Project[]) => {
      setProjects(() => {
        const list = [...newOrder];
        saveProjectOrder(list);
        return list;
      });
    },
    [setProjects, saveProjectOrder]
  );

  const handleDeleteProject = useCallback(
    async (project: Project) => {
      try {
        const res = await window.electronAPI.deleteProject(project.id);
        if (!res?.success) throw new Error(res?.error || 'Failed to delete project');

        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('project_deleted');
        setProjects((prev) => prev.filter((p) => p.id !== project.id));
        if (selectedProject?.id === project.id) {
          setSelectedProject(null);
          setActiveTask(null);
          setShowHomeView(true);
        }
        toast({ title: 'Project deleted', description: `"${project.name}" was removed.` });
      } catch (err) {
        const { log } = await import('../lib/logger');
        log.error('Delete project failed:', err as any);
        toast({
          title: 'Error',
          description:
            err instanceof Error
              ? err.message
              : 'Could not delete project. See console for details.',
          variant: 'destructive',
        });
      }
    },
    [selectedProject, setProjects, setSelectedProject, setActiveTask, setShowHomeView, toast]
  );

  return {
    handleOpenProject,
    handleNewProjectClick,
    handleCloneProjectClick,
    handleSelectProject,
    handleGoHome,
    handleDeleteTask,
    handleReorderProjects,
    handleReorderProjectsFull,
    handleDeleteProject,
    handleCloneSuccess,
    handleNewProjectSuccess,
    activateProjectView,
    saveProjectOrder,
    applyProjectOrder,
  };
}
