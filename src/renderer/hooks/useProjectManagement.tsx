import { useCallback, useEffect, useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ToastAction } from '@radix-ui/react-toast';
import { pickDefaultBranch } from '../components/BranchSelect';
import { saveActiveIds } from '../constants/layout';
import {
  computeBaseRef,
  getProjectRepoKey,
  normalizePathForComparison,
  resolveProjectGithubInfo,
  withRepoKey,
} from '../lib/projectUtils';
import type { Project } from '../types/app';
import { rpc } from '../lib/rpc';
import { useModalContext } from '../contexts/ModalProvider';
import { useAppContext } from '../contexts/AppContextProvider';
import { useGithubContext } from '../contexts/GithubContextProvider';
import { useToast } from './use-toast';

// ---------------------------------------------------------------------------
// Shared helper — build a Project object from a local git path.
// Returns null when the path is not a git repository.
// ---------------------------------------------------------------------------
async function buildProjectFromGitPath(
  gitPath: string,
  platform: string,
  isAuthenticated: boolean
): Promise<{
  projectToSave: Project;
  remoteUrl: string;
  repoKey: string;
  isGitRepo: boolean;
} | null> {
  const gitInfo = await window.electronAPI.getGitInfo(gitPath);
  const selectedPath = gitInfo.path || gitPath;
  const repoCanonicalPath = gitInfo.rootPath || selectedPath;
  const repoKey = normalizePathForComparison(repoCanonicalPath, platform);
  const remoteUrl = gitInfo.remote || '';
  const projectName = selectedPath.split(/[/\\]/).filter(Boolean).pop() || 'Unknown Project';

  if (!gitInfo.isGitRepo) {
    return { projectToSave: null as unknown as Project, remoteUrl, repoKey, isGitRepo: false };
  }

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

  return { projectToSave, remoteUrl, repoKey, isGitRepo: true };
}

export const useProjectManagement = () => {
  const { platform } = useAppContext();
  const {
    authenticated: isAuthenticated,
    installed: ghInstalled,
    handleGithubConnect,
  } = useGithubContext();
  const { toast } = useToast();
  const { showModal } = useModalContext();
  const queryClient = useQueryClient();

  const [selectedProject, setSelectedProject] = useState<Project | null>(null);

  const activeProjectIdRef = useRef<string | null>(null);
  activeProjectIdRef.current = selectedProject?.id || null;

  // Always start on home view (e.g. after app restart)
  const [showHomeView, setShowHomeView] = useState<boolean>(true);
  const [showSkillsView, setShowSkillsView] = useState(false);
  const [showEditorMode, setShowEditorMode] = useState(false);
  const [showKanban, setShowKanban] = useState(false);
  // Trigger counters — incremented to signal task management to reset active task / auto-open modal
  const [resetTaskTrigger, setResetTaskTrigger] = useState(0);
  const [autoOpenTaskModalTrigger, setAutoOpenTaskModalTrigger] = useState(0);
  const [projectBranchOptions, setProjectBranchOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [projectDefaultBranch, setProjectDefaultBranch] = useState<string>('main');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [hasResolvedBranchOptions, setHasResolvedBranchOptions] = useState(false);

  // ---------------------------------------------------------------------------
  // Project list query — React Query is the single source of truth
  // ---------------------------------------------------------------------------
  const { data: rawProjects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const projs = await rpc.db.getProjects();
      return projs.map((p) => withRepoKey(p, platform ?? ''));
    },
    enabled: !!platform,
    staleTime: Infinity,
  });

  const projects = rawProjects ?? [];
  const isInitialLoadComplete = rawProjects !== undefined;

  // ---------------------------------------------------------------------------
  // Mutations — all project writes go through here
  // ---------------------------------------------------------------------------
  const addProjectMutation = useMutation({
    mutationFn: (project: Project) => rpc.db.saveProject(project),
    onMutate: (project) => {
      queryClient.setQueryData<Project[]>(['projects'], (old = []) => [project, ...old]);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (project: Project) => {
      await window.electronAPI
        .worktreeRemoveReserve({
          projectId: project.id,
          projectPath: project.path,
          isRemote: project.isRemote,
        })
        .catch(() => {});
      await rpc.db.deleteProject(project.id);
    },
    onMutate: (project) => {
      // Optimistically remove from cache
      queryClient.setQueryData<Project[]>(['projects'], (old = []) =>
        old.filter((p) => p.id !== project.id)
      );
      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
        setResetTaskTrigger((t) => t + 1);
        setShowHomeView(true);
        saveActiveIds(null, null);
      }
    },
    onError: (_err, project, _ctx) => {
      // Rollback optimistic removal
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      void import('../lib/logger').then(({ log }) => {
        log.error('Delete project failed:', _err as any);
      });
      toast({
        title: 'Error',
        description:
          _err instanceof Error
            ? _err.message
            : 'Could not delete project. See console for details.',
        variant: 'destructive',
      });
    },
    onSuccess: (_, project) => {
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('project_deleted');
      });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast({ title: 'Project deleted', description: `"${project.name}" was removed.` });
    },
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
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
        .catch(() => {});
    },
    []
  );

  const activateProjectView = useCallback(
    (project: Project) => {
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('project_view_opened');
      });
      setSelectedProject(project);
      setShowHomeView(false);
      setShowSkillsView(false);
      setResetTaskTrigger((t) => t + 1);
      setShowEditorMode(false);
      setShowKanban(false);
      saveActiveIds(project.id, null);
      prewarmReserveForBaseRef(
        project.id,
        project.path,
        project.gitInfo?.isGitRepo,
        project.gitInfo?.baseRef || 'HEAD'
      );
    },
    [prewarmReserveForBaseRef]
  );

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  const handleGoHome = () => {
    setSelectedProject(null);
    setShowHomeView(true);
    setShowSkillsView(false);
    setResetTaskTrigger((t) => t + 1);
    setShowEditorMode(false);
    setShowKanban(false);
    saveActiveIds(null, null);
  };

  const handleGoToSkills = () => {
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('skills_view_opened');
    });
    setSelectedProject(null);
    setShowHomeView(false);
    setShowSkillsView(true);
    setResetTaskTrigger((t) => t + 1);
    setShowEditorMode(false);
    setShowKanban(false);
    saveActiveIds(null, null);
  };

  const handleSelectProject = (project: Project) => {
    activateProjectView(project);
  };

  // ---------------------------------------------------------------------------
  // Project actions — open / new / clone / remote
  // ---------------------------------------------------------------------------
  const handleOpenProject = async () => {
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('project_add_clicked');
    });
    try {
      const result = await window.electronAPI.openProject();
      if (result.success && result.path) {
        try {
          const built = await buildProjectFromGitPath(result.path, platform ?? '', isAuthenticated);
          if (!built) return;

          if (!built.isGitRepo) {
            toast({
              title: 'Project Opened',
              description: `This directory is not a Git repository. Path: ${result.path}`,
              variant: 'destructive',
            });
            return;
          }

          const existingProject = projects.find(
            (p) => getProjectRepoKey(p, platform) === built.repoKey
          );
          if (existingProject) {
            activateProjectView(existingProject);
            toast({
              title: 'Project already open',
              description: `"${existingProject.name}" is already in the sidebar.`,
            });
            return;
          }

          await addProjectMutation.mutateAsync(built.projectToSave);
          void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
            captureTelemetry('project_added_success', { source: 'open' });
          });
          activateProjectView(built.projectToSave);
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
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('project_create_clicked');
    });
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
    showModal('newProjectModal', { onSuccess: handleNewProjectSuccess });
  };

  const handleCloneProjectClick = async () => {
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('project_clone_clicked');
    });
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
    showModal('cloneFromUrlModal', { onSuccess: handleCloneSuccess });
  };

  const handleCloneSuccess = useCallback(
    async (projectPath: string) => {
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('project_cloned');
      });
      try {
        const built = await buildProjectFromGitPath(projectPath, platform ?? '', isAuthenticated);
        if (!built || !built.isGitRepo) return;

        const existingProject = projects.find(
          (p) => getProjectRepoKey(p, platform) === built.repoKey
        );
        if (existingProject) {
          activateProjectView(existingProject);
          return;
        }

        await addProjectMutation.mutateAsync(built.projectToSave);
        void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('project_clone_success');
          captureTelemetry('project_added_success', { source: 'clone' });
        });
        activateProjectView(built.projectToSave);
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
    [projects, isAuthenticated, activateProjectView, platform, toast, addProjectMutation]
  );

  const handleNewProjectSuccess = useCallback(
    async (projectPath: string) => {
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('new_project_created');
      });
      try {
        const built = await buildProjectFromGitPath(projectPath, platform ?? '', isAuthenticated);
        if (!built || !built.isGitRepo) return;

        const existingProject = projects.find(
          (p) => getProjectRepoKey(p, platform) === built.repoKey
        );
        if (existingProject) {
          activateProjectView(existingProject);
          return;
        }

        await addProjectMutation.mutateAsync(built.projectToSave);
        void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('project_create_success');
          captureTelemetry('project_added_success', { source: 'new_project' });
        });
        toast({
          title: 'Project created successfully!',
          description: `${built.projectToSave.name} has been added to your projects.`,
        });
        activateProjectView(built.projectToSave);

        const isGithubRemote = /github\.com[:/]/i.test(built.remoteUrl);
        if (!isAuthenticated || !isGithubRemote) {
          setAutoOpenTaskModalTrigger((t) => t + 1);
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
    [projects, isAuthenticated, activateProjectView, platform, toast, addProjectMutation]
  );

  const handleDeleteProject = (project: Project) => {
    deleteProjectMutation.mutate(project);
  };

  interface RemoteProjectInput {
    id: string;
    name: string;
    path: string;
    host: string;
    connectionId: string;
  }

  const handleRemoteProjectSuccess = useCallback(
    async (remoteProject: RemoteProjectInput) => {
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('remote_project_created');
      });
      try {
        const repoKey = `${remoteProject.host}:${remoteProject.path}`;
        const existingProject = projects.find((p) => getProjectRepoKey(p) === repoKey);

        if (existingProject) {
          activateProjectView(existingProject);
          toast({
            title: 'Project already open',
            description: `"${existingProject.name}" is already in the sidebar.`,
          });
          return;
        }

        const project: Project = {
          id: remoteProject.id,
          name: remoteProject.name,
          path: remoteProject.path,
          repoKey,
          gitInfo: { isGitRepo: true },
          tasks: [],
          isRemote: true,
          sshConnectionId: remoteProject.connectionId,
          remotePath: remoteProject.path,
        } as Project;

        await addProjectMutation.mutateAsync(project);
        void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('project_create_success');
          captureTelemetry('project_added_success', { source: 'remote' });
        });
        toast({
          title: 'Remote project added successfully!',
          description: `${project.name} on ${remoteProject.host} has been added to your projects.`,
        });
        activateProjectView(project);
      } catch (error) {
        const { log } = await import('../lib/logger');
        log.error('Failed to save remote project:', error);
        toast({
          title: 'Failed to add remote project',
          description: 'An error occurred while saving the project.',
          variant: 'destructive',
        });
      }
    },
    [projects, activateProjectView, toast, addProjectMutation]
  );

  const handleAddRemoteProject = useCallback(() => {
    showModal('addRemoteProjectModal', { onSuccess: handleRemoteProjectSuccess });
  }, [showModal, handleRemoteProjectSuccess]);

  const refreshBranches = useCallback(async () => {
    if (!selectedProject) return;

    const originProjectId = selectedProject.id;

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
        if (res.success && res.branches) {
          options = res.branches.map((b) => ({
            value: b.ref,
            label: b.remote ? b.label : `${b.branch} (local)`,
          }));
        } else {
          options = [];
        }
      }

      if (activeProjectIdRef.current !== originProjectId) {
        return;
      }

      // Only update state if we found branches
      if (options.length > 0) {
        setProjectBranchOptions(options);
        const currentRef = selectedProject.gitInfo?.baseRef;
        const defaultBranch = pickDefaultBranch(options, currentRef);
        setProjectDefaultBranch(defaultBranch ?? currentRef ?? 'main');
      }
    } catch (error) {
      console.error('Failed to load branches:', error);
    } finally {
      if (activeProjectIdRef.current === originProjectId) {
        setIsLoadingBranches(false);
        setHasResolvedBranchOptions(true);
      }
    }
  }, [selectedProject]);

  // Initial load when project changes
  useEffect(() => {
    if (!selectedProject) {
      setProjectBranchOptions([]);
      setProjectDefaultBranch('main');
      setHasResolvedBranchOptions(false);
      return;
    }

    const currentRef = selectedProject.gitInfo?.baseRef;
    const initialBranch = currentRef || 'main';
    setProjectBranchOptions([{ value: initialBranch, label: initialBranch }]);
    setProjectDefaultBranch(initialBranch);
    setHasResolvedBranchOptions(false);

    void refreshBranches();
  }, [selectedProject, refreshBranches]);

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
    selectedProject,
    setSelectedProject,
    showHomeView,
    setShowHomeView,
    showSkillsView,
    setShowSkillsView,
    showEditorMode,
    setShowEditorMode,
    showKanban,
    setShowKanban,
    resetTaskTrigger,
    autoOpenTaskModalTrigger,
    handleGoToSkills,
    projectBranchOptions,
    projectDefaultBranch,
    setProjectDefaultBranch,
    isLoadingBranches,
    refreshBranches,
    activateProjectView,
    handleGoHome,
    handleSelectProject,
    handleOpenProject,
    handleNewProjectClick,
    handleCloneProjectClick,
    handleCloneSuccess,
    handleNewProjectSuccess,
    handleDeleteProject,
    handleRemoteProjectSuccess,
    handleAddRemoteProject,
    isInitialLoadComplete,
  };
};
