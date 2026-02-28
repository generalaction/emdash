import { useCallback, useEffect, useState } from 'react';
import { pickDefaultBranch } from '../components/BranchSelect';
import { saveActiveIds } from '../constants/layout';
import {
  computeBaseRef,
  getProjectRepoKey,
  normalizePathForComparison,
  resolveProjectGithubInfo,
  withRepoKey,
} from '../lib/projectUtils';
import type { Project, Task } from '../types/app';
import { rpc } from '../lib/rpc';

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
  } = options;

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  // Always start on home view (e.g. after app restart)
  const [showHomeView, setShowHomeView] = useState<boolean>(true);
  const [showSkillsView, setShowSkillsView] = useState(false);
  const [projectBranchOptions, setProjectBranchOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [projectDefaultBranch, setProjectDefaultBranch] = useState<string>('main');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [hasResolvedBranchOptions, setHasResolvedBranchOptions] = useState(false);

  const prewarmReserveForBaseRef = useCallback(
    (projectId: string, projectPath: string, isGitRepo: boolean | undefined, baseRef?: string) => {
      if (!isGitRepo) return;
      const requestedBaseRef = (baseRef || '').trim() || 'HEAD';
      window.electronAPI
        .worktreeEnsureReserve({
          projectId,
          projectPath,
          baseRef: requestedBaseRef,
        })
        .catch(() => {
          // Silently ignore - reserves are optional optimization
        });
    },
    []
  );

  const activateProjectView = useCallback(
    (project: Project) => {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('project_view_opened');
      })();
      setSelectedProject(project);
      setShowHomeView(false);
      setShowSkillsView(false);
      setActiveTask(null);
      setShowEditorMode(false);
      setShowKanban(false);
      saveActiveIds(project.id, null);

      // Start creating a reserve worktree in the background for instant task creation.
      prewarmReserveForBaseRef(
        project.id,
        project.path,
        project.gitInfo?.isGitRepo,
        project.gitInfo?.baseRef || 'HEAD'
      );
    },
    [prewarmReserveForBaseRef]
  );

  const handleGoHome = () => {
    setSelectedProject(null);
    setShowHomeView(true);
    setShowSkillsView(false);
    setActiveTask(null);
    setShowEditorMode(false);
    setShowKanban(false);
    saveActiveIds(null, null);
  };

  const handleGoToSkills = () => {
    void (async () => {
      const { captureTelemetry } = await import('../lib/telemetryClient');
      captureTelemetry('skills_view_opened');
    })();
    setSelectedProject(null);
    setShowHomeView(false);
    setShowSkillsView(true);
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
          const selectedPath = gitInfo.path || result.path;
          const repoCanonicalPath = gitInfo.rootPath || selectedPath;
          const repoKey = normalizePathForComparison(repoCanonicalPath, platform);
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
          const projectName =
            selectedPath.split(/[/\\]/).filter(Boolean).pop() || 'Unknown Project';

          const baseProject: Project = {
            id: Date.now().toString(),
            name: projectName,
            path: selectedPath,
            repoKey,
            gitInfo: {
              isGitRepo: true,
              remote: gitInfo.remote || undefined,
              branch: gitInfo.branch || undefined,
              baseRef: computeBaseRef(gitInfo.baseRef, gitInfo.remote, gitInfo.branch),
            },
            tasks: [],
          };

          const ghInfo = await resolveProjectGithubInfo(
            selectedPath,
            remoteUrl,
            isAuthenticated,
            window.electronAPI.connectToGitHub
          );

          const projectToSave = withRepoKey(
            {
              ...baseProject,
              githubInfo: {
                repository: ghInfo.repository,
                connected: ghInfo.connected,
              },
            },
            platform
          );

          try {
            await rpc.db.saveProject(projectToSave);
          } catch (e) {
            toast({
              title: 'Failed to save project',
              description: 'Please check the console for details.',
              variant: 'destructive',
            })
          }
          const { captureTelemetry } = await import('../lib/telemetryClient');
          captureTelemetry('project_added_success', { source: ghInfo.source });
          setProjects((prev) => [...prev, projectToSave]);
          activateProjectView(projectToSave);
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
        const selectedPath = gitInfo.path || projectPath;
        const repoCanonicalPath = gitInfo.rootPath || selectedPath;
        const repoKey = normalizePathForComparison(repoCanonicalPath, platform);
        const existingProject = projects.find(
          (project) => getProjectRepoKey(project, platform) === repoKey
        );

        if (existingProject) {
          activateProjectView(existingProject);
          return;
        }

        const remoteUrl = gitInfo.remote || '';
        const projectName = selectedPath.split(/[/\\]/).filter(Boolean).pop() || 'Unknown Project';

        const baseProject: Project = {
          id: Date.now().toString(),
          name: projectName,
          path: selectedPath,
          repoKey,
          gitInfo: {
            isGitRepo: true,
            remote: gitInfo.remote || undefined,
            branch: gitInfo.branch || undefined,
            baseRef: computeBaseRef(gitInfo.baseRef, gitInfo.remote, gitInfo.branch),
          },
          tasks: [],
        };

        const ghInfo = await resolveProjectGithubInfo(
          selectedPath,
          remoteUrl,
          isAuthenticated,
          window.electronAPI.connectToGitHub
        );

        const projectToSave = withRepoKey(
          {
            ...baseProject,
            githubInfo: {
              repository: ghInfo.repository,
              connected: ghInfo.connected,
            },
          },
          platform
        );

        await rpc.db.saveProject(projectToSave);
        captureTelemetry('project_clone_success');
        captureTelemetry('project_added_success', { source: 'clone' });
        setProjects((prev) => [...prev, projectToSave]);
        activateProjectView(projectToSave);
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
        const selectedPath = gitInfo.path || projectPath;
        const repoCanonicalPath = gitInfo.rootPath || selectedPath;
        const repoKey = normalizePathForComparison(repoCanonicalPath, platform);
        const existingProject = projects.find(
          (project) => getProjectRepoKey(project, platform) === repoKey
        );

        if (existingProject) {
          activateProjectView(existingProject);
          return;
        }

        const remoteUrl = gitInfo.remote || '';
        const projectName = selectedPath.split(/[/\\]/).filter(Boolean).pop() || 'Unknown Project';

        const baseProject: Project = {
          id: Date.now().toString(),
          name: projectName,
          path: selectedPath,
          repoKey,
          gitInfo: {
            isGitRepo: true,
            remote: gitInfo.remote || undefined,
            branch: gitInfo.branch || undefined,
            baseRef: computeBaseRef(gitInfo.baseRef, gitInfo.remote, gitInfo.branch),
          },
          tasks: [],
        };

        const ghInfo = await resolveProjectGithubInfo(
          selectedPath,
          remoteUrl,
          isAuthenticated,
          window.electronAPI.connectToGitHub
        );

        const projectToSave = withRepoKey(
          {
            ...baseProject,
            githubInfo: {
              repository: ghInfo.repository,
              connected: ghInfo.connected,
            },
          },
          platform
        );

        await rpc.db.saveProject(projectToSave);
        captureTelemetry('project_create_success');
        captureTelemetry('project_added_success', { source: 'new_project' });
          toast({
            title: 'Project created successfully!',
            description: `${projectToSave.name} has been added to your projects.`,
          });
          // Add to beginning of list
          setProjects((prev) => {
            const updated = [projectToSave, ...prev];
            saveProjectOrder(updated);
            return updated;
          });
          activateProjectView(projectToSave);

          // Auto-open task modal for non-GitHub projects
          const isGithubRemote = /github\.com[:/]/i.test(remoteUrl);
          if (!isAuthenticated || !isGithubRemote) {
            setShowTaskModal(true);
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
    [
      projects,
      isAuthenticated,
      activateProjectView,
      platform,
      toast,
      saveProjectOrder,
      setShowTaskModal,
    ]
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
      await window.electronAPI
        .worktreeRemoveReserve({
          projectId: project.id,
          projectPath: project.path,
          isRemote: project.isRemote,
        })
        .catch(() => {});

      await rpc.db.deleteProject(project.id);

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
      setHasResolvedBranchOptions(false);
      return;
    }

    // Show current baseRef immediately while loading full list, or reset to defaults
    const currentRef = selectedProject.gitInfo?.baseRef;
    const initialBranch = currentRef || 'main';
    setProjectBranchOptions([{ value: initialBranch, label: initialBranch }]);
    setProjectDefaultBranch(initialBranch);
    setHasResolvedBranchOptions(false);

    let cancelled = false;
    const loadBranches = async () => {
      setIsLoadingBranches(true);
      try {
        let options: { value: string; label: string }[];

        if (selectedProject.isRemote && selectedProject.sshConnectionId) {
          // Load branches over SSH for remote projects
          const result = await window.electronAPI.sshExecuteCommand(
            selectedProject.sshConnectionId,
            'git branch -a --format="%(refname:short)"',
            selectedProject.path
          );
          if (cancelled) return;
          if (result.exitCode === 0 && result.stdout) {
            const branches = result.stdout
              .split('\n')
              .map((b) => b.trim())
              .filter((b) => b.length > 0 && !b.includes('HEAD'));
            options = branches.map((b) => ({
              value: b,
              label: b,
            }));
          } else {
            options = [];
          }
        } else {
          const res = await window.electronAPI.listRemoteBranches({
            projectPath: selectedProject.path,
          });
          if (cancelled) return;
          if (res.success && res.branches) {
            options = res.branches.map((b) => ({
              value: b.ref,
              label: b.remote ? b.label : `${b.branch} (local)`,
            }));
          } else {
            options = [];
          }
        }

        if (!cancelled && options.length > 0) {
          setProjectBranchOptions(options);
          const defaultBranch = pickDefaultBranch(options, currentRef);
          setProjectDefaultBranch(defaultBranch ?? currentRef ?? 'main');
        }
      } catch (error) {
        console.error('Failed to load branches:', error);
      } finally {
        if (!cancelled) {
          setIsLoadingBranches(false);
          setHasResolvedBranchOptions(true);
        }
      }
    };

    void loadBranches();
    return () => {
      cancelled = true;
    };
  }, [selectedProject]);

  // Keep reserves warm for the currently selected base ref.
  useEffect(() => {
    if (!selectedProject) return;
    if (!hasResolvedBranchOptions) return;
    if (isLoadingBranches) return;
    const preferredBaseRef = (projectDefaultBranch || '').trim();
    const hasPreferredRef = projectBranchOptions.some(
      (option) => option.value === preferredBaseRef
    );
    const fallbackBaseRef = (selectedProject.gitInfo?.baseRef || '').trim() || 'HEAD';
    const baseRefForPrewarm = hasPreferredRef ? preferredBaseRef : fallbackBaseRef;
    prewarmReserveForBaseRef(
      selectedProject.id,
      selectedProject.path,
      selectedProject.gitInfo?.isGitRepo,
      baseRefForPrewarm
    );
  }, [
    selectedProject?.id,
    selectedProject?.path,
    selectedProject?.gitInfo?.isGitRepo,
    selectedProject?.gitInfo?.baseRef,
    hasResolvedBranchOptions,
    isLoadingBranches,
    projectDefaultBranch,
    projectBranchOptions,
    prewarmReserveForBaseRef,
  ]);

  return {
    projects,
    setProjects,
    selectedProject,
    setSelectedProject,
    showHomeView,
    setShowHomeView,
    showSkillsView,
    setShowSkillsView,
    handleGoToSkills,
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
