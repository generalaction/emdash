import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ToastAction } from '@radix-ui/react-toast';
import { normalizePathForComparison, withRepoKey } from '../lib/projectUtils';
import type { Project } from '../types/app';
import type { LocalProject } from '@shared/types/projects';
import { rpc } from '../lib/rpc';
import { useModalContext } from '../contexts/ModalProvider';
import { useAppContext } from '../contexts/AppContextProvider';
import { useGithubContext } from '../contexts/GithubContextProvider';
import { useToast } from './use-toast';
import { useWorkspaceNavigation } from '../contexts/WorkspaceNavigationContext';

// ---------------------------------------------------------------------------
// Adapter — maps the flat _new/ LocalProject shape to the renderer Project type
// so existing components don't need to change.
// ---------------------------------------------------------------------------
function toProject(p: LocalProject, platform: string): Project {
  return withRepoKey(
    {
      id: p.id,
      name: p.name,
      path: p.path,
      gitInfo: {
        isGitRepo: true,
        remote: p.gitRemote,
        branch: p.gitBranch,
        baseRef: p.baseRef,
      },
      githubInfo: p.github,
      tasks: [],
    },
    platform
  );
}

function projectNameFromPath(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? 'Unknown Project';
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
  const { navigate } = useWorkspaceNavigation();

  const [autoOpenTaskModalTrigger, setAutoOpenTaskModalTrigger] = useState(0);

  // ---------------------------------------------------------------------------
  // Project list query — fetches LocalProject[] from _new/ controller,
  // adapts to Project[] for backward-compatibility with existing components.
  // ---------------------------------------------------------------------------
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const raw = await rpc.projects.getProjects();
      return raw.map((p) => toProject(p, platform ?? ''));
    },
    enabled: !!platform,
    staleTime: Infinity,
  });

  const isInitialLoadComplete = projects !== undefined;

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const addProjectMutation = useMutation({
    mutationFn: async ({ path, name }: { path: string; name: string }) => {
      const result = await rpc.projects.createProject({ type: 'local', path, name });
      if (!result.success) throw new Error(result.error.type);
      return toProject(result.data, platform ?? '');
    },
    onMutate: async ({ path, name }) => {
      const placeholder: Project = withRepoKey(
        {
          id: `optimistic-${Date.now()}`,
          name,
          path,
          gitInfo: { isGitRepo: true },
          tasks: [],
        },
        platform ?? ''
      );
      queryClient.setQueryData<Project[]>(['projects'], (old = []) => [placeholder, ...old]);
      return { placeholder };
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: async (project: Project) => {
      // Reserve cleanup is handled by EnvironmentProviderManager.removeProject in main.
      await rpc.projects.deleteProject(project.id);
    },
    onMutate: (project) => {
      queryClient.setQueryData<Project[]>(['projects'], (old = []) =>
        old.filter((p) => p.id !== project.id)
      );
      navigate('home');
    },
    onError: (_err) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      void import('../lib/logger').then(({ log }) => {
        log.error('Delete project failed:', _err as never);
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
  // Project actions
  // ---------------------------------------------------------------------------
  const handleOpenProject = async () => {
    void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('project_add_clicked');
    });
    try {
      const result = await rpc.project.open();
      if (result.success && result.path) {
        const path = result.path;
        const name = projectNameFromPath(path);

        const key = normalizePathForComparison(path, platform ?? '');
        const existing = projects.find(
          (p) => normalizePathForComparison(p.path, platform ?? '') === key
        );
        if (existing) {
          navigate('project', { projectId: existing.id });
          toast({
            title: 'Project already open',
            description: `"${existing.name}" is already in the sidebar.`,
          });
          return;
        }

        try {
          const saved = await addProjectMutation.mutateAsync({ path, name });
          void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
            captureTelemetry('project_added_success', { source: 'open' });
          });
          navigate('project', { projectId: saved.id });
        } catch (error) {
          const err = error as { message?: string };
          if (err?.message === 'invalid_git_repository') {
            toast({
              title: 'Not a Git repository',
              description: `The selected directory is not a Git repository. Path: ${path}`,
              variant: 'destructive',
            });
          } else {
            toast({
              title: 'Failed to Open Project',
              description: err?.message ?? 'Please check the console for details.',
              variant: 'destructive',
            });
          }
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
      log.error('Open project error:', error as never);
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
        const name = projectNameFromPath(projectPath);
        const key = normalizePathForComparison(projectPath, platform ?? '');
        const existing = projects.find(
          (p) => normalizePathForComparison(p.path, platform ?? '') === key
        );
        if (existing) {
          navigate('project', { projectId: existing.id });
          return;
        }
        const saved = await addProjectMutation.mutateAsync({ path: projectPath, name });
        void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('project_clone_success');
          captureTelemetry('project_added_success', { source: 'clone' });
        });
        navigate('project', { projectId: saved.id });
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
    [projects, navigate, platform, toast, addProjectMutation]
  );

  const handleNewProjectSuccess = useCallback(
    async (projectPath: string) => {
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('new_project_created');
      });
      try {
        const name = projectNameFromPath(projectPath);
        const key = normalizePathForComparison(projectPath, platform ?? '');
        const existing = projects.find(
          (p) => normalizePathForComparison(p.path, platform ?? '') === key
        );
        if (existing) {
          navigate('project', { projectId: existing.id });
          return;
        }
        const saved = await addProjectMutation.mutateAsync({ path: projectPath, name });
        void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('project_create_success');
          captureTelemetry('project_added_success', { source: 'new_project' });
        });
        toast({
          title: 'Project created successfully!',
          description: `${saved.name} has been added to your projects.`,
        });
        navigate('project', { projectId: saved.id });

        const isGithubRemote = /github\.com[:/]/i.test(saved.gitInfo?.remote ?? '');
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
    [projects, isAuthenticated, navigate, platform, toast, addProjectMutation]
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
        const existingProject = projects.find((p) => p.repoKey === repoKey);
        if (existingProject) {
          navigate('project', { projectId: existingProject.id });
          toast({
            title: 'Project already open',
            description: `"${existingProject.name}" is already in the sidebar.`,
          });
          return;
        }

        // Remote projects still go through the legacy db.saveProject path until
        // _new/ projects controller gains remote support.
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
        };
        await rpc.db.saveProject(project as never);
        void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('project_create_success');
          captureTelemetry('project_added_success', { source: 'remote' });
        });
        toast({
          title: 'Remote project added successfully!',
          description: `${project.name} on ${remoteProject.host} has been added to your projects.`,
        });
        queryClient.invalidateQueries({ queryKey: ['projects'] });
        navigate('project', { projectId: project.id });
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
    [projects, navigate, toast, queryClient]
  );

  const handleAddRemoteProject = useCallback(() => {
    showModal('addRemoteProjectModal', { onSuccess: handleRemoteProjectSuccess });
  }, [showModal, handleRemoteProjectSuccess]);

  return {
    projects,
    autoOpenTaskModalTrigger,
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
