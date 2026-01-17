import { useCallback, useEffect, useState } from 'react';
import type { Project, Task } from '../types/app';
import { useToast } from './use-toast';
import { PROJECT_ORDER_KEY } from '../constants/layout';
import {
  computeBaseRef,
  getProjectRepoKey,
  normalizePathForComparison,
  withRepoKey,
} from '../lib/projectUtils';
import { pickDefaultBranch } from '../components/BranchSelect';

/**
 * Hook to manage project state and operations
 * Handles project CRUD, selection, ordering, and branch management
 */

export interface ProjectManagementState {
  projects: Project[];
  selectedProject: Project | null;
  showHomeView: boolean;
  projectBranchOptions: Array<{ value: string; label: string }>;
  projectDefaultBranch: string;
  isLoadingBranches: boolean;
  platform: string;
}

export interface ProjectManagementActions {
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  setSelectedProject: React.Dispatch<React.SetStateAction<Project | null>>;
  activateProjectView: (project: Project) => void;
  handleGoHome: () => void;
  handleSelectProject: (project: Project) => void;
  handleOpenProject: () => Promise<void>;
  handleDeleteProject: (project: Project) => Promise<void>;
  handleReorderProjects: (sourceId: string, targetId: string) => void;
  handleReorderProjectsFull: (newOrder: Project[]) => void;
  setProjectDefaultBranch: (branch: string) => void;
}

interface UseProjectManagementOptions {
  isAuthenticated?: boolean;
  setActiveTask?: (task: Task | null) => void;
  setActiveTaskProvider?: (provider: any) => void;
}

export function useProjectManagement(
  options: UseProjectManagementOptions = {}
): ProjectManagementState & ProjectManagementActions {
  const { isAuthenticated = false, setActiveTask, setActiveTaskProvider } = options;
  const { toast } = useToast();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showHomeView, setShowHomeView] = useState<boolean>(true);
  const [platform, setPlatform] = useState<string>('');

  // Branch management
  const [projectBranchOptions, setProjectBranchOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [projectDefaultBranch, setProjectDefaultBranch] = useState<string>('main');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);

  // Project ordering utilities
  const applyProjectOrder = useCallback((list: Project[]) => {
    try {
      const raw = localStorage.getItem(PROJECT_ORDER_KEY);
      if (!raw) return list;
      const order: string[] = JSON.parse(raw);
      const indexOf = (id: string) => {
        const idx = order.indexOf(id);
        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
      };
      return [...list].sort((a, b) => indexOf(a.id) - indexOf(b.id));
    } catch {
      return list;
    }
  }, []);

  const saveProjectOrder = useCallback((list: Project[]) => {
    try {
      const ids = list.map((p) => p.id);
      localStorage.setItem(PROJECT_ORDER_KEY, JSON.stringify(ids));
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Initialize platform
  useEffect(() => {
    window.electronAPI.getPlatform().then(setPlatform).catch(console.error);
  }, []);

  // Load branch options when project is selected
  useEffect(() => {
    if (!selectedProject) {
      setProjectBranchOptions([]);
      setProjectDefaultBranch('main');
      return;
    }

    // Show current baseRef immediately while loading full list
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

  // Project view activation
  const activateProjectView = useCallback(
    (project: Project) => {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('project_view_opened');
      })();
      setSelectedProject(project);
      setShowHomeView(false);
      setActiveTask?.(null);
    },
    [setActiveTask]
  );

  // Navigation handlers
  const handleGoHome = useCallback(() => {
    setSelectedProject(null);
    setShowHomeView(true);
    setActiveTask?.(null);
  }, [setActiveTask]);

  const handleSelectProject = useCallback(
    (project: Project) => {
      activateProjectView(project);
    },
    [activateProjectView]
  );

  // Open existing project
  const handleOpenProject = useCallback(async () => {
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

          // Handle GitHub connection if authenticated
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
            // Save project without GitHub connection
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
  }, [
    projects,
    platform,
    isAuthenticated,
    activateProjectView,
    toast,
  ]);

  // Delete project
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
          setActiveTask?.(null);
          setShowHomeView(true);
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
    },
    [selectedProject, setActiveTask, toast]
  );

  // Reorder projects
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
    [saveProjectOrder]
  );

  const handleReorderProjectsFull = useCallback(
    (newOrder: Project[]) => {
      setProjects(() => {
        const list = [...newOrder];
        saveProjectOrder(list);
        return list;
      });
    },
    [saveProjectOrder]
  );

  return {
    // State
    projects,
    selectedProject,
    showHomeView,
    projectBranchOptions,
    projectDefaultBranch,
    isLoadingBranches,
    platform,

    // Actions
    setProjects,
    setSelectedProject,
    activateProjectView,
    handleGoHome,
    handleSelectProject,
    handleOpenProject,
    handleDeleteProject,
    handleReorderProjects,
    handleReorderProjectsFull,
    setProjectDefaultBranch,
  };
}