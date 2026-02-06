import { useCallback, useEffect, useState } from 'react';
import { pickDefaultBranch } from '../components/BranchSelect';
import { saveActiveIds } from '../constants/layout';
import {
  computeBaseRef,
  getProjectRepoKey,
  normalizePathForComparison,
  withRepoKey,
} from '../lib/projectUtils';
import type { Project, Task } from '../types/app';

interface UseProjectManagementOptions {
  platform: string;
  isAuthenticated: boolean;
  ghInstalled: boolean;
  toast: (opts: any) => void;
  handleGithubConnect: () => void;
  setShowEditorMode: React.Dispatch<React.SetStateAction<boolean>>;
  setShowKanban: React.Dispatch<React.SetStateAction<boolean>>;
  setShowNewProjectModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCloneModal: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTaskModal: React.Dispatch<React.SetStateAction<boolean>>;
  setActiveTask: React.Dispatch<React.SetStateAction<Task | null>>;
  saveProjectOrder: (list: Project[]) => void;
  ToastAction: React.ComponentType<any>;
  storedActiveIds: { projectId: string | null; taskId: string | null };
}

export const useProjectManagement = (options: UseProjectManagementOptions) => {
  const {
    platform,
    isAuthenticated,
    ghInstalled,
    toast,
    handleGithubConnect,
    setShowEditorMode,
    setShowKanban,
    setShowNewProjectModal,
    setShowCloneModal,
    setShowTaskModal,
    setActiveTask,
    saveProjectOrder,
    ToastAction,
    storedActiveIds,
  } = options;

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const hasPendingRestore = storedActiveIds.projectId !== null;
  // Start with showHomeView=false if we have a pending restore to prevent flash
  const [showHomeView, setShowHomeView] = useState<boolean>(!hasPendingRestore);
  const [projectBranchOptions, setProjectBranchOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [projectDefaultBranch, setProjectDefaultBranch] = useState<string>('main');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);

  const activateProjectView = useCallback((project: Project) => {
    void (async () => {
      const { captureTelemetry } = await import('../lib/telemetryClient');
      captureTelemetry('project_view_opened');
    })();
    setSelectedProject(project);
    setShowHomeView(false);
    setActiveTask(null);
    setShowEditorMode(false);
    setShowKanban(false);
    saveActiveIds(project.id, null);

    // Start creating a reserve worktree in the background for instant task creation
    if (project.gitInfo?.isGitRepo) {
      const baseRef = project.gitInfo?.baseRef || 'HEAD';
      window.electronAPI
        .worktreeEnsureReserve({
          projectId: project.id,
          projectPath: project.path,
          baseRef,
        })
        .catch(() => {
          // Silently ignore - reserves are optional optimization
        });
    }
  }, []);

  const handleGoHome = () => {
    setSelectedProject(null);
    setShowHomeView(true);
    setActiveTask(null);
    setShowEditorMode(false);
    setShowKanban(false);
    saveActiveIds(null, null);
  };

  const handleSelectProject = (project: Project) => {
    activateProjectView(project);
  };

  const handleOpenProject = async () => {
    const { captureTelemetry } = await import('../lib/telemetryClient');
    captureTelemetry('project_add_clicked');
    try {
      const result = await window.electronAPI.openProject();
      if (result.success && result.path) {
        try {
          const gitInfo = await window.electronAPI.getGitInfo(result.path);
          const canonicalPath = gitInfo.rootPath || gitInfo.path || result.path;
          const repoKey = normalizePathForComparison(canonicalPath, platform);
          const existingProject = projects.find(
            (project) => getProjectRepoKey(project, platform) === repoKey
          );

          if (existingProject) {
            activateProjectView(existingProject);
            toast({
              title: 'Project already open',
              description: `"${existingProject.name}" is already in the sidebar.`,
            });
            return;
          }

          if (!gitInfo.isGitRepo) {
            toast({
              title: 'Project Opened',
              description: `This directory is not a Git repository. Path: ${result.path}`,
              variant: 'destructive',
            });
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
                const { captureTelemetry } = await import('../lib/telemetryClient');
                captureTelemetry('project_added_success', { source: 'github' });
                setProjects((prev) => [...prev, projectWithGithub]);
                activateProjectView(projectWithGithub);
              } else {
                const { log } = await import('../lib/logger');
                log.error('Failed to save project:', saveResult.error);
                toast({
                  title: 'Failed to Add Project',
                  description:
                    'Project opened but could not be saved to database. Please check console for details.',
                  variant: 'destructive',
                });
              }
            } else {
              const updateHint =
                platform === 'darwin'
                  ? 'Tip: Update GitHub CLI with: brew upgrade gh — then restart Emdash.'
                  : platform === 'win32'
                    ? 'Tip: Update GitHub CLI with: winget upgrade GitHub.cli — then restart Emdash.'
                    : 'Tip: Update GitHub CLI via your package manager (e.g., apt/dnf) and restart Emdash.';
              toast({
                title: 'GitHub Connection Failed',
                description: `Git repository detected but couldn't connect to GitHub: ${githubInfo.error}\n\n${updateHint}`,
                variant: 'destructive',
              });
            }
          } else {
            const projectWithoutGithub = withRepoKey(
              {
                ...baseProject,
                githubInfo: {
                  repository: isGithubRemote ? '' : '',
                  connected: false,
                },
              },
              platform
            );

            const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
            if (saveResult.success) {
              const { captureTelemetry } = await import('../lib/telemetryClient');
              captureTelemetry('project_added_success', { source: 'local' });
              setProjects((prev) => [...prev, projectWithoutGithub]);
              activateProjectView(projectWithoutGithub);
            } else {
              const { log } = await import('../lib/logger');
              log.error('Failed to save project:', saveResult.error);
              toast({
                title: 'Failed to Add Project',
                description:
                  'Project opened but could not be saved to database. Please check console for details.',
                variant: 'destructive',
              });
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
      } else if (result.error) {
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
  };

  const handleNewProjectClick = async () => {
    const { captureTelemetry } = await import('../lib/telemetryClient');
    captureTelemetry('project_create_clicked');

    if (!isAuthenticated || !ghInstalled) {
      toast({
        title: 'GitHub authentication required',
        variant: 'destructive',
        action: (
          <ToastAction altText="Connect GitHub" onClick={handleGithubConnect}>
            Connect GitHub
          </ToastAction>
        ),
      });
      return;
    }

    setShowNewProjectModal(true);
  };

  const handleCloneProjectClick = async () => {
    const { captureTelemetry } = await import('../lib/telemetryClient');
    captureTelemetry('project_clone_clicked');

    if (!isAuthenticated || !ghInstalled) {
      toast({
        title: 'GitHub authentication required',
        variant: 'destructive',
        action: (
          <ToastAction altText="Connect GitHub" onClick={handleGithubConnect}>
            Connect GitHub
          </ToastAction>
        ),
      });
      return;
    }

    setShowCloneModal(true);
  };

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
          activateProjectView(existingProject);
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
              activateProjectView(projectWithGithub);
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
              activateProjectView(projectWithoutGithub);
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
            activateProjectView(projectWithoutGithub);
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
    [projects, isAuthenticated, activateProjectView, platform, toast]
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
          activateProjectView(existingProject);
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
              // Add to beginning of list
              setProjects((prev) => {
                const updated = [projectWithGithub, ...prev];
                saveProjectOrder(updated);
                return updated;
              });
              activateProjectView(projectWithGithub);
            } else {
              const { log } = await import('../lib/logger');
              log.error('Failed to save project:', saveResult.error);
              toast({
                title: 'Project Created',
                description: 'Repository created but failed to save to database.',
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
              captureTelemetry('project_create_success');
              captureTelemetry('project_added_success', { source: 'new_project' });
              toast({
                title: 'Project created successfully!',
                description: `${projectWithoutGithub.name} has been added to your projects.`,
              });
              // Add to beginning of list
              setProjects((prev) => {
                const updated = [projectWithoutGithub, ...prev];
                saveProjectOrder(updated);
                return updated;
              });
              activateProjectView(projectWithoutGithub);
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
            // Add to beginning of list
            setProjects((prev) => {
              const updated = [projectWithoutGithub, ...prev];
              saveProjectOrder(updated);
              return updated;
            });
            activateProjectView(projectWithoutGithub);
            setShowTaskModal(true);
          }
        }
      } catch (error) {
        const { log } = await import('../lib/logger');
        log.error('Failed to load new project:', error);
        toast({
          title: 'Project Created',
          description: 'Repository created but failed to load. Please try opening it manually.',
          variant: 'destructive',
        });
      }
    },
    [projects, isAuthenticated, activateProjectView, platform, toast, saveProjectOrder, setShowTaskModal]
  );

  const handleReorderProjects = (sourceId: string, targetId: string) => {
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
  };

  const handleReorderProjectsFull = (newOrder: Project[]) => {
    setProjects(() => {
      const list = [...newOrder];
      saveProjectOrder(list);
      return list;
    });
  };

  const handleDeleteProject = async (project: Project) => {
    try {
      // Clean up reserve worktree before deleting project
      await window.electronAPI.worktreeRemoveReserve({ projectId: project.id }).catch(() => {});

      const res = await window.electronAPI.deleteProject(project.id);
      if (!res?.success) throw new Error(res?.error || 'Failed to delete project');

      const { captureTelemetry } = await import('../lib/telemetryClient');
      captureTelemetry('project_deleted');
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
        setActiveTask(null);
        setShowHomeView(true);
        saveActiveIds(null, null);
      }
      toast({ title: 'Project deleted', description: `"${project.name}" was removed.` });
    } catch (err) {
      const { log } = await import('../lib/logger');
      log.error('Delete project failed:', err as any);
      toast({
        title: 'Error',
        description:
          err instanceof Error ? err.message : 'Could not delete project. See console for details.',
        variant: 'destructive',
      });
    }
  };

  // Load branch options when project is selected
  useEffect(() => {
    if (!selectedProject) {
      setProjectBranchOptions([]);
      setProjectDefaultBranch('main');
      return;
    }

    // Show current baseRef immediately while loading full list, or reset to defaults
    const currentRef = selectedProject.gitInfo?.baseRef;
    const initialBranch = currentRef || 'main';
    setProjectBranchOptions([{ value: initialBranch, label: initialBranch }]);
    setProjectDefaultBranch(initialBranch);

    let cancelled = false;
    const loadBranches = async () => {
      setIsLoadingBranches(true);
      try {
        const res = await window.electronAPI.listRemoteBranches({
          projectPath: selectedProject.path,
        });
        if (cancelled) return;
        if (res.success && res.branches) {
          const options = res.branches.map((b) => ({ value: b.label, label: b.label }));
          setProjectBranchOptions(options);
          const defaultBranch = pickDefaultBranch(options, currentRef);
          setProjectDefaultBranch(defaultBranch ?? currentRef ?? 'main');
        }
      } catch (error) {
        console.error('Failed to load branches:', error);
      } finally {
        if (!cancelled) {
          setIsLoadingBranches(false);
        }
      }
    };

    void loadBranches();
    return () => {
      cancelled = true;
    };
  }, [selectedProject]);

  return {
    projects,
    setProjects,
    selectedProject,
    setSelectedProject,
    showHomeView,
    setShowHomeView,
    projectBranchOptions,
    projectDefaultBranch,
    setProjectDefaultBranch,
    isLoadingBranches,
    activateProjectView,
    handleGoHome,
    handleSelectProject,
    handleOpenProject,
    handleNewProjectClick,
    handleCloneProjectClick,
    handleCloneSuccess,
    handleNewProjectSuccess,
    handleReorderProjects,
    handleReorderProjectsFull,
    handleDeleteProject,
  };
};
