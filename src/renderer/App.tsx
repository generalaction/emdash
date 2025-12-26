import { motion } from 'framer-motion';
import { FolderOpen, Github, Plus } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import emdashLogo from '../assets/images/emdash/emdash_logo.svg';
import emdashLogoWhite from '../assets/images/emdash/emdash_logo_white.svg';
import AppKeyboardShortcuts from './components/AppKeyboardShortcuts';
import BrowserPane from './components/BrowserPane';
import ChatInterface from './components/ChatInterface';
import { CloneFromUrlModal } from './components/CloneFromUrlModal';
import CommandPaletteWrapper from './components/CommandPaletteWrapper';
import ErrorBoundary from './components/ErrorBoundary';
import FirstLaunchModal from './components/FirstLaunchModal';
import { GithubDeviceFlowModal } from './components/GithubDeviceFlowModal';
import KanbanBoard from './components/kanban/KanbanBoard';
import LeftSidebar from './components/LeftSidebar';
import MultiAgentTask from './components/MultiAgentTask';
import { NewProjectModal } from './components/NewProjectModal';
import ProjectMainView from './components/ProjectMainView';
import RightSidebar from './components/RightSidebar';
import SettingsModal from './components/SettingsModal';
import TaskModal from './components/TaskModal';
import { ThemeProvider } from './components/ThemeProvider';
import Titlebar from './components/titlebar/Titlebar';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/resizable';
import { RightSidebarProvider, useRightSidebar } from './components/ui/right-sidebar';
import { SidebarProvider } from './components/ui/sidebar';
import { ToastAction } from './components/ui/toast';
import { Toaster } from './components/ui/toaster';
import { useToast } from './hooks/use-toast';
import { useGithubAuth } from './hooks/useGithubAuth';
import { usePlanToasts } from './hooks/usePlanToasts';
import { useTheme } from './hooks/useTheme';
import useUpdateNotifier from './hooks/useUpdateNotifier';
import { getContainerRunState } from './lib/containerRuns';
import { loadPanelSizes, savePanelSizes } from './lib/persisted-layout';
import { isLinux, isMac, isWindows } from './lib/platform';
import { BrowserProvider } from './providers/BrowserProvider';
import { terminalSessionRegistry } from './terminal/SessionRegistry';
import { type Provider } from './types';
import type { Project, Task } from './types/app';
import type { TaskMetadata } from './types/chat';
import { type GitHubIssueSummary } from './types/github';
import { type JiraIssueSummary } from './types/jira';
import { type LinearIssueSummary } from './types/linear';

const TERMINAL_PROVIDER_IDS = [
  'qwen',
  'codex',
  'claude',
  'droid',
  'gemini',
  'cursor',
  'copilot',
  'amp',
  'opencode',
  'charm',
  'auggie',
  'kimi',
  'kiro',
  'rovo',
] as const;

const RightSidebarBridge: React.FC<{
  onCollapsedChange: (collapsed: boolean) => void;
  setCollapsedRef: React.MutableRefObject<((next: boolean) => void) | null>;
}> = ({ onCollapsedChange, setCollapsedRef }) => {
  const { collapsed, setCollapsed } = useRightSidebar();

  useEffect(() => {
    onCollapsedChange(collapsed);
  }, [collapsed, onCollapsedChange]);

  useEffect(() => {
    setCollapsedRef.current = setCollapsed;
    return () => {
      setCollapsedRef.current = null;
    };
  }, [setCollapsed, setCollapsedRef]);

  return null;
};

const TITLEBAR_HEIGHT = '36px';
const PANEL_LAYOUT_STORAGE_KEY = 'emdash.layout.left-main-right.v2';
const DEFAULT_PANEL_LAYOUT: [number, number, number] = [20, 60, 20];
const LEFT_SIDEBAR_MIN_SIZE = 16;
const LEFT_SIDEBAR_MAX_SIZE = 30;
const FIRST_LAUNCH_KEY = 'emdash:first-launch:v1';
const RIGHT_SIDEBAR_MIN_SIZE = 16;
const RIGHT_SIDEBAR_MAX_SIZE = 50;
const clampLeftSidebarSize = (value: number) =>
  Math.min(
    Math.max(Number.isFinite(value) ? value : DEFAULT_PANEL_LAYOUT[0], LEFT_SIDEBAR_MIN_SIZE),
    LEFT_SIDEBAR_MAX_SIZE
  );
const clampRightSidebarSize = (value: number) =>
  Math.min(
    Math.max(Number.isFinite(value) ? value : DEFAULT_PANEL_LAYOUT[2], RIGHT_SIDEBAR_MIN_SIZE),
    RIGHT_SIDEBAR_MAX_SIZE
  );
const MAIN_PANEL_MIN_SIZE = 30;

const AppContent: React.FC = () => {
  usePlanToasts();
  // Initialize theme on app startup
  const { effectiveTheme } = useTheme();

  const { toast } = useToast();
  const [_, setVersion] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const {
    installed: ghInstalled,
    authenticated: isAuthenticated,
    user,
    checkStatus,
    login: githubLogin,
    isInitialized: isGithubInitialized,
  } = useGithubAuth();
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubStatusMessage, setGithubStatusMessage] = useState<string | undefined>();
  const [showDeviceFlowModal, setShowDeviceFlowModal] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showTaskModal, setShowTaskModal] = useState<boolean>(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState<boolean>(false);
  const [showCloneModal, setShowCloneModal] = useState<boolean>(false);
  const [showHomeView, setShowHomeView] = useState<boolean>(true);
  const [isCreatingTask, setIsCreatingTask] = useState<boolean>(false);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskProvider, setActiveTaskProvider] = useState<Provider | null>(null);
  const [installedProviders, setInstalledProviders] = useState<Record<string, boolean>>({});
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showFeedback, setShowFeedback] = useState<boolean>(false);
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showFirstLaunchModal, setShowFirstLaunchModal] = useState<boolean>(false);
  const showGithubRequirement = !ghInstalled || !isAuthenticated;
  // Show agent requirements block if we have status data and none of the CLI providers are detected locally.
  const showAgentRequirement =
    Object.keys(installedProviders).length > 0 &&
    Object.values(installedProviders).every((v) => v === false);
  const deletingTaskIdsRef = useRef<Set<string>>(new Set());

  const normalizePathForComparison = useCallback(
    (input: string | null | undefined) => {
      if (!input) return '';

      let normalized = input.replace(/\\/g, '/');
      normalized = normalized.replace(/\/+/g, '/');

      if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.replace(/\/+$/, '');
      }

      const platformKey =
        platform && platform.length > 0
          ? platform
          : typeof process !== 'undefined'
            ? process.platform
            : '';
      return platformKey.toLowerCase().startsWith('win') ? normalized.toLowerCase() : normalized;
    },
    [platform]
  );

  const computeBaseRef = useCallback(
    (baseRef?: string | null, remote?: string | null, branch?: string | null) => {
      const remoteName = (() => {
        const trimmed = (remote ?? '').trim();
        if (!trimmed) return 'origin';
        if (/^[A-Za-z0-9._-]+$/.test(trimmed) && !trimmed.includes('://')) return trimmed;
        return 'origin';
      })();
      const normalize = (value?: string | null): string | undefined => {
        if (!value) return undefined;
        const trimmed = value.trim();
        if (!trimmed || trimmed.includes('://')) return undefined;
        if (trimmed.includes('/')) {
          const [head, ...rest] = trimmed.split('/');
          const branchPart = rest.join('/').replace(/^\/+/, '');
          if (head && branchPart) return `${head}/${branchPart}`;
          if (!head && branchPart) return `${remoteName}/${branchPart}`;
          return undefined;
        }
        const suffix = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
        return `${remoteName}/${suffix}`;
      };
      return normalize(baseRef) ?? normalize(branch) ?? `${remoteName}/main`;
    },
    []
  );

  const getProjectRepoKey = useCallback(
    (project: Pick<Project, 'path' | 'repoKey'>) =>
      project.repoKey ?? normalizePathForComparison(project.path),
    [normalizePathForComparison]
  );

  const withRepoKey = useCallback(
    (project: Project): Project => {
      const repoKey = getProjectRepoKey(project);
      if (project.repoKey === repoKey) {
        return project;
      }
      return { ...project, repoKey };
    },
    [getProjectRepoKey]
  );

  // Show toast on update availability and kick off a background check
  useUpdateNotifier({ checkOnMount: true, onOpenSettings: () => setShowSettings(true) });

  const defaultPanelLayout = React.useMemo(() => {
    const stored = loadPanelSizes(PANEL_LAYOUT_STORAGE_KEY, DEFAULT_PANEL_LAYOUT);
    const [storedLeft = DEFAULT_PANEL_LAYOUT[0], , storedRight = DEFAULT_PANEL_LAYOUT[2]] =
      Array.isArray(stored) && stored.length === 3
        ? (stored as [number, number, number])
        : DEFAULT_PANEL_LAYOUT;
    const left = clampLeftSidebarSize(storedLeft);
    const right = clampRightSidebarSize(storedRight);
    const middle = Math.max(0, 100 - left - right);
    return [left, middle, right] as [number, number, number];
  }, []);

  const rightSidebarDefaultWidth = React.useMemo(
    () => clampRightSidebarSize(defaultPanelLayout[2]),
    [defaultPanelLayout]
  );
  const leftSidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const rightSidebarPanelRef = useRef<ImperativePanelHandle | null>(null);
  const lastLeftSidebarSizeRef = useRef<number>(defaultPanelLayout[0]);
  const lastRightSidebarSizeRef = useRef<number>(rightSidebarDefaultWidth);
  const leftSidebarSetOpenRef = useRef<((next: boolean) => void) | null>(null);
  const leftSidebarIsMobileRef = useRef<boolean>(false);
  const leftSidebarOpenRef = useRef<boolean>(true);
  const rightSidebarSetCollapsedRef = useRef<((next: boolean) => void) | null>(null);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState<boolean>(false);

  const handlePanelLayout = useCallback((sizes: number[]) => {
    if (!Array.isArray(sizes) || sizes.length < 3) {
      return;
    }

    if (leftSidebarIsMobileRef.current) {
      return;
    }

    const [leftSize, , rightSize] = sizes;
    const rightCollapsed = typeof rightSize === 'number' && rightSize <= 0.5;

    let storedLeft = lastLeftSidebarSizeRef.current;
    if (typeof leftSize === 'number') {
      if (leftSize <= 0.5) {
        leftSidebarSetOpenRef.current?.(false);
        leftSidebarOpenRef.current = false;
      } else {
        leftSidebarSetOpenRef.current?.(true);
        leftSidebarOpenRef.current = true;
        if (!rightCollapsed) {
          storedLeft = clampLeftSidebarSize(leftSize);
          lastLeftSidebarSizeRef.current = storedLeft;
        }
      }
    }

    let storedRight = lastRightSidebarSizeRef.current;
    if (typeof rightSize === 'number') {
      if (rightSize <= 0.5) {
        rightSidebarSetCollapsedRef.current?.(true);
      } else {
        storedRight = clampRightSidebarSize(rightSize);
        lastRightSidebarSizeRef.current = storedRight;
        rightSidebarSetCollapsedRef.current?.(false);
      }
    }

    const middle = Math.max(0, 100 - storedLeft - storedRight);
    savePanelSizes(PANEL_LAYOUT_STORAGE_KEY, [storedLeft, middle, storedRight]);
  }, []);

  const handleSidebarContextChange = useCallback(
    ({
      open,
      isMobile,
      setOpen,
    }: {
      open: boolean;
      isMobile: boolean;
      setOpen: (next: boolean) => void;
    }) => {
      leftSidebarSetOpenRef.current = setOpen;
      leftSidebarIsMobileRef.current = isMobile;
      leftSidebarOpenRef.current = open;
      const panel = leftSidebarPanelRef.current;
      if (!panel) {
        return;
      }

      if (isMobile) {
        const currentSize = panel.getSize();
        if (typeof currentSize === 'number' && currentSize > 0) {
          lastLeftSidebarSizeRef.current = clampLeftSidebarSize(currentSize);
        }
        panel.collapse();
        return;
      }

      if (open) {
        const target = clampLeftSidebarSize(
          lastLeftSidebarSizeRef.current || DEFAULT_PANEL_LAYOUT[0]
        );
        panel.expand();
        panel.resize(target);
      } else {
        const currentSize = panel.getSize();
        if (typeof currentSize === 'number' && currentSize > 0) {
          lastLeftSidebarSizeRef.current = clampLeftSidebarSize(currentSize);
        }
        panel.collapse();
      }
    },
    []
  );

  const activateProjectView = useCallback((project: Project) => {
    void (async () => {
      const { captureTelemetry } = await import('./lib/telemetryClient');
      captureTelemetry('project_view_opened');
    })();
    setSelectedProject(project);
    setShowHomeView(false);
    setActiveTask(null);
  }, []);

  const handleRightSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    setRightSidebarCollapsed(collapsed);
  }, []);

  const handleToggleSettings = useCallback(() => {
    setShowSettings((prev) => !prev);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setShowSettings(false);
  }, []);

  const handleOpenFeedback = useCallback(() => {
    void import('./lib/telemetryClient').then(({ captureTelemetry }) => {
      captureTelemetry('toolbar_feedback_clicked');
    });
    setShowFeedback(true);
  }, []);

  const handleCloseFeedback = useCallback(() => {
    setShowFeedback(false);
  }, []);

  const handleToggleCommandPalette = useCallback(() => {
    setShowCommandPalette((prev) => !prev);
  }, []);

  const handleCloseCommandPalette = useCallback(() => {
    setShowCommandPalette(false);
  }, []);

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
    setShowFirstLaunchModal(false);
  }, []);

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
      setShowFirstLaunchModal(true);
    };
    void check();
  }, []);

  useEffect(() => {
    const rightPanel = rightSidebarPanelRef.current;
    if (rightPanel) {
      if (rightSidebarCollapsed) {
        rightPanel.collapse();
      } else {
        const targetRight = clampRightSidebarSize(
          lastRightSidebarSizeRef.current || DEFAULT_PANEL_LAYOUT[2]
        );
        lastRightSidebarSizeRef.current = targetRight;
        rightPanel.expand();
        rightPanel.resize(targetRight);
      }
    }

    if (leftSidebarIsMobileRef.current || !leftSidebarOpenRef.current) {
      return;
    }

    const leftPanel = leftSidebarPanelRef.current;
    if (!leftPanel) {
      return;
    }

    const targetLeft = clampLeftSidebarSize(
      lastLeftSidebarSizeRef.current || DEFAULT_PANEL_LAYOUT[0]
    );
    lastLeftSidebarSizeRef.current = targetLeft;
    leftPanel.expand();
    leftPanel.resize(targetLeft);
  }, [rightSidebarCollapsed]);

  // Persist and apply custom project order (by id)
  const ORDER_KEY = 'sidebarProjectOrder';
  const applyProjectOrder = (list: Project[]) => {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
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
  };
  const saveProjectOrder = (list: Project[]) => {
    try {
      const ids = list.map((p) => p.id);
      localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
    } catch {}
  };

  useEffect(() => {
    const loadAppData = async () => {
      try {
        const [appVersion, appPlatform, projects] = await Promise.all([
          window.electronAPI.getAppVersion(),
          window.electronAPI.getPlatform(),
          window.electronAPI.getProjects(),
        ]);

        setVersion(appVersion);
        setPlatform(appPlatform);
        const initialProjects = applyProjectOrder(projects.map(withRepoKey));
        setProjects(initialProjects);

        // Refresh GH status via hook
        checkStatus();

        const projectsWithTasks = await Promise.all(
          initialProjects.map(async (project) => {
            const tasks = await window.electronAPI.getTasks(project.id);
            return withRepoKey({ ...project, tasks });
          })
        );
        const ordered = applyProjectOrder(projectsWithTasks);
        setProjects(ordered);

        // Prefer cached provider status (populated in the background)
        let providerInstalls: Record<string, boolean> = {};
        try {
          type ProviderStatusEntry = {
            installed: boolean;
            path?: string | null;
            version?: string | null;
            lastChecked: number;
          };
          const statusResponse =
            ((await (window as any).electronAPI.getProviderStatuses?.()) as
              | { success?: boolean; statuses?: Record<string, ProviderStatusEntry> }
              | undefined) ?? (await window.electronAPI.getProviderStatuses?.());
          if (statusResponse?.success && statusResponse.statuses) {
            providerInstalls = Object.fromEntries(
              Object.entries(statusResponse.statuses).map(([id, s]) => [id, s?.installed === true])
            );
          }
        } catch {
          // ignore and fall back to direct checks
        }

        setInstalledProviders(providerInstalls);
      } catch (error) {
        const { log } = await import('./lib/logger');
        log.error('Failed to load app data:', error as any);
      }
    };

    loadAppData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track fullscreen state for macOS titlebar padding
  useEffect(() => {
    // Get initial state
    window.electronAPI.getFullScreenState().then(setIsFullscreen);

    // Listen for native fullscreen changes from main process
    const unsubscribe = window.electronAPI.onFullScreenChange((isFull) => {
      setIsFullscreen(isFull);
    });

    return unsubscribe;
  }, []);

  const handleOpenProject = async () => {
    const { captureTelemetry } = await import('./lib/telemetryClient');
    captureTelemetry('project_add_clicked');
    try {
      const result = await window.electronAPI.openProject();
      if (result.success && result.path) {
        try {
          const gitInfo = await window.electronAPI.getGitInfo(result.path);
          const canonicalPath = gitInfo.rootPath || gitInfo.path || result.path;
          const repoKey = normalizePathForComparison(canonicalPath);
          const existingProject = projects.find(
            (project) => getProjectRepoKey(project) === repoKey
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
              const projectWithGithub = withRepoKey({
                ...baseProject,
                githubInfo: {
                  repository: githubInfo.repository || '',
                  connected: true,
                },
              });

              const saveResult = await window.electronAPI.saveProject(projectWithGithub);
              if (saveResult.success) {
                const { captureTelemetry } = await import('./lib/telemetryClient');
                captureTelemetry('project_added_success', { source: 'github' });
                setProjects((prev) => [...prev, projectWithGithub]);
                activateProjectView(projectWithGithub);
              } else {
                const { log } = await import('./lib/logger');
                log.error('Failed to save project:', saveResult.error);
              }
            } else {
              const updateHint = isMac(platform)
                ? 'Tip: Update GitHub CLI with: brew upgrade gh — then restart Emdash.'
                : isWindows(platform)
                  ? 'Tip: Update GitHub CLI with: winget upgrade GitHub.cli — then restart Emdash.'
                  : 'Tip: Update GitHub CLI via your package manager (e.g., apt/dnf) and restart Emdash.';
              toast({
                title: 'GitHub Connection Failed',
                description: `Git repository detected but couldn't connect to GitHub: ${githubInfo.error}\n\n${updateHint}`,
                variant: 'destructive',
              });
            }
          } else {
            const projectWithoutGithub = withRepoKey({
              ...baseProject,
              githubInfo: {
                repository: isGithubRemote ? '' : '',
                connected: false,
              },
            });

            const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
            if (saveResult.success) {
              const { captureTelemetry } = await import('./lib/telemetryClient');
              captureTelemetry('project_added_success', { source: 'local' });
              setProjects((prev) => [...prev, projectWithoutGithub]);
              activateProjectView(projectWithoutGithub);
            } else {
              const { log } = await import('./lib/logger');
              log.error('Failed to save project:', saveResult.error);
            }
          }
        } catch (error) {
          const { log } = await import('./lib/logger');
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
      const { log } = await import('./lib/logger');
      log.error('Open project error:', error as any);
      toast({
        title: 'Failed to Open Project',
        description: 'Please check the console for details.',
        variant: 'destructive',
      });
    }
  };

  const handleCloneSuccess = useCallback(
    async (projectPath: string) => {
      const { captureTelemetry } = await import('./lib/telemetryClient');
      captureTelemetry('project_cloned');
      try {
        const gitInfo = await window.electronAPI.getGitInfo(projectPath);
        const canonicalPath = gitInfo.rootPath || gitInfo.path || projectPath;
        const repoKey = normalizePathForComparison(canonicalPath);
        const existingProject = projects.find((project) => getProjectRepoKey(project) === repoKey);

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
            const projectWithGithub = withRepoKey({
              ...baseProject,
              githubInfo: {
                repository: githubInfo.repository || '',
                connected: true,
              },
            });

            const saveResult = await window.electronAPI.saveProject(projectWithGithub);
            if (saveResult.success) {
              captureTelemetry('project_clone_success');
              captureTelemetry('project_added_success', { source: 'clone' });
              setProjects((prev) => [...prev, projectWithGithub]);
              activateProjectView(projectWithGithub);
            } else {
              const { log } = await import('./lib/logger');
              log.error('Failed to save project:', saveResult.error);
              toast({
                title: 'Project Cloned',
                description: 'Repository cloned but failed to save to database.',
                variant: 'destructive',
              });
            }
          } else {
            const projectWithoutGithub = withRepoKey({
              ...baseProject,
              githubInfo: {
                repository: '',
                connected: false,
              },
            });

            const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
            if (saveResult.success) {
              captureTelemetry('project_clone_success');
              captureTelemetry('project_added_success', { source: 'clone' });
              setProjects((prev) => [...prev, projectWithoutGithub]);
              activateProjectView(projectWithoutGithub);
            }
          }
        } else {
          const projectWithoutGithub = withRepoKey({
            ...baseProject,
            githubInfo: {
              repository: '',
              connected: false,
            },
          });

          const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
          if (saveResult.success) {
            captureTelemetry('project_clone_success');
            captureTelemetry('project_added_success', { source: 'clone' });
            setProjects((prev) => [...prev, projectWithoutGithub]);
            activateProjectView(projectWithoutGithub);
          }
        }
      } catch (error) {
        const { log } = await import('./lib/logger');
        log.error('Failed to load cloned project:', error);
        toast({
          title: 'Project Cloned',
          description: 'Repository cloned but failed to load. Please try opening it manually.',
          variant: 'destructive',
        });
      }
    },
    [
      projects,
      isAuthenticated,
      activateProjectView,
      normalizePathForComparison,
      toast,
      computeBaseRef,
      withRepoKey,
    ]
  );

  const handleNewProjectSuccess = useCallback(
    async (projectPath: string) => {
      const { captureTelemetry } = await import('./lib/telemetryClient');
      captureTelemetry('new_project_created');
      try {
        const gitInfo = await window.electronAPI.getGitInfo(projectPath);
        const canonicalPath = gitInfo.rootPath || gitInfo.path || projectPath;
        const repoKey = normalizePathForComparison(canonicalPath);
        const existingProject = projects.find((project) => getProjectRepoKey(project) === repoKey);

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
            const projectWithGithub = withRepoKey({
              ...baseProject,
              githubInfo: {
                repository: githubInfo.repository || '',
                connected: true,
              },
            });

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
              const { log } = await import('./lib/logger');
              log.error('Failed to save project:', saveResult.error);
              toast({
                title: 'Project Created',
                description: 'Repository created but failed to save to database.',
                variant: 'destructive',
              });
            }
          } else {
            const projectWithoutGithub = withRepoKey({
              ...baseProject,
              githubInfo: {
                repository: '',
                connected: false,
              },
            });

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
          const projectWithoutGithub = withRepoKey({
            ...baseProject,
            githubInfo: {
              repository: '',
              connected: false,
            },
          });

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
        const { log } = await import('./lib/logger');
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
      normalizePathForComparison,
      toast,
      computeBaseRef,
      withRepoKey,
      getProjectRepoKey,
    ]
  );

  const handleGithubConnect = async () => {
    setGithubLoading(true);
    setGithubStatusMessage(undefined);

    try {
      // Check if gh CLI is installed
      setGithubStatusMessage('Checking for GitHub CLI...');
      const cliInstalled = await window.electronAPI.githubCheckCLIInstalled();

      if (!cliInstalled) {
        // Detect platform for better messaging
        let installMessage = 'Installing GitHub CLI...';
        if (isMac(platform)) {
          installMessage = 'Installing GitHub CLI via Homebrew...';
        } else if (isLinux(platform)) {
          installMessage = 'Installing GitHub CLI via apt...';
        } else if (isWindows(platform)) {
          installMessage = 'Installing GitHub CLI via winget...';
        }

        setGithubStatusMessage(installMessage);
        const installResult = await window.electronAPI.githubInstallCLI();

        if (!installResult.success) {
          setGithubLoading(false);
          setGithubStatusMessage(undefined);
          toast({
            title: 'Installation Failed',
            description: `Could not auto-install gh CLI: ${installResult.error || 'Unknown error'}`,
            variant: 'destructive',
          });
          return;
        }

        setGithubStatusMessage('GitHub CLI installed! Setting up connection...');
        toast({
          title: 'GitHub CLI Installed',
          description: 'Now authenticating with GitHub...',
        });
        await checkStatus(); // Refresh status
      }

      // Start Device Flow authentication (main process handles polling)
      setGithubStatusMessage('Starting authentication...');
      const result = await githubLogin();

      setGithubLoading(false);
      setGithubStatusMessage(undefined);

      if (result?.success) {
        // Show modal - it will receive events from main process
        setShowDeviceFlowModal(true);
      } else {
        toast({
          title: 'Authentication Failed',
          description: result?.error || 'Could not start authentication',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('GitHub connection error:', error);
      setGithubLoading(false);
      setGithubStatusMessage(undefined);
      toast({
        title: 'Connection Failed',
        description: 'Failed to connect to GitHub. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleCreateTask = async (
    taskName: string,
    initialPrompt?: string,
    providerRuns: import('./types/chat').ProviderRun[] = [{ provider: 'claude', runs: 1 }],
    linkedLinearIssue: LinearIssueSummary | null = null,
    linkedGithubIssue: GitHubIssueSummary | null = null,
    linkedJiraIssue: JiraIssueSummary | null = null,
    autoApprove?: boolean
  ) => {
    if (!selectedProject) return;

    setIsCreatingTask(true);
    try {
      let preparedPrompt: string | undefined = undefined;
      if (initialPrompt && initialPrompt.trim()) {
        const parts: string[] = [];
        if (linkedLinearIssue) {
          // Enrich linked issue with description from Linear, if available
          let issue = linkedLinearIssue;
          try {
            const api: any = (window as any).electronAPI;
            let description: string | undefined;
            // Try bulk search first
            try {
              const res = await api?.linearGetIssues?.([linkedLinearIssue.identifier]);
              const arr = res?.issues || res || [];
              const node = Array.isArray(arr)
                ? arr.find(
                    (n: any) => String(n?.identifier) === String(linkedLinearIssue.identifier)
                  )
                : null;
              if (node?.description) description = String(node.description);
            } catch {}
            // Fallback to single issue endpoint
            if (!description) {
              const single = await api?.linearGetIssue?.(linkedLinearIssue.identifier);
              if (single?.success && single.issue?.description) {
                description = String(single.issue.description);
              } else if (single?.description) {
                description = String(single.description);
              }
            }
            if (description) {
              issue = { ...linkedLinearIssue, description } as any;
            }
          } catch {}
          const detailParts: string[] = [];
          const stateName = issue.state?.name?.trim();
          const assigneeName = issue.assignee?.displayName?.trim() || issue.assignee?.name?.trim();
          const teamKey = issue.team?.key?.trim();
          const projectName = issue.project?.name?.trim();
          if (stateName) detailParts.push(`State: ${stateName}`);
          if (assigneeName) detailParts.push(`Assignee: ${assigneeName}`);
          if (teamKey) detailParts.push(`Team: ${teamKey}`);
          if (projectName) detailParts.push(`Project: ${projectName}`);
          parts.push(`Linear: ${issue.identifier} — ${issue.title}`);
          if (detailParts.length) parts.push(`Details: ${detailParts.join(' • ')}`);
          if (issue.url) parts.push(`URL: ${issue.url}`);
          if ((issue as any).description) {
            parts.push('');
            parts.push('Issue Description:');
            parts.push(String((issue as any).description).trim());
          }
          parts.push('');
        }
        if (linkedGithubIssue) {
          // Enrich linked GitHub issue with body via gh if available
          let issue = linkedGithubIssue;
          try {
            const api: any = (window as any).electronAPI;
            const res = await api?.githubIssueGet?.(selectedProject.path, linkedGithubIssue.number);
            if (res?.success) {
              const body: string | undefined = res?.issue?.body || res?.body;
              if (body) issue = { ...linkedGithubIssue, body } as any;
            }
          } catch {}
          const detailParts: string[] = [];
          const stateName = issue.state?.toString()?.trim();
          const assignees = Array.isArray(issue.assignees)
            ? issue.assignees
                .map((a) => a?.name || a?.login)
                .filter(Boolean)
                .join(', ')
            : '';
          const labels = Array.isArray(issue.labels)
            ? issue.labels
                .map((l) => l?.name)
                .filter(Boolean)
                .join(', ')
            : '';
          if (stateName) detailParts.push(`State: ${stateName}`);
          if (assignees) detailParts.push(`Assignees: ${assignees}`);
          if (labels) detailParts.push(`Labels: ${labels}`);
          parts.push(`GitHub: #${issue.number} — ${issue.title}`);
          if (detailParts.length) parts.push(`Details: ${detailParts.join(' • ')}`);
          if (issue.url) parts.push(`URL: ${issue.url}`);
          if ((issue as any).body) {
            parts.push('');
            parts.push('Issue Description:');
            parts.push(String((issue as any).body).trim());
          }
          parts.push('');
        }
        parts.push(initialPrompt.trim());
        preparedPrompt = parts.join('\n');
      }

      const taskMetadata: TaskMetadata | null =
        linkedLinearIssue || linkedJiraIssue || linkedGithubIssue || preparedPrompt || autoApprove
          ? {
              linearIssue: linkedLinearIssue ?? null,
              jiraIssue: linkedJiraIssue ?? null,
              githubIssue: linkedGithubIssue ?? null,
              initialPrompt: preparedPrompt ?? null,
              autoApprove: autoApprove ?? null,
            }
          : null;

      // Calculate total runs and determine if multi-agent
      const totalRuns = providerRuns.reduce((sum, pr) => sum + pr.runs, 0);
      const isMultiAgent = totalRuns > 1;
      const primaryProvider = providerRuns[0]?.provider || 'claude';

      let newTask: Task;
      if (isMultiAgent) {
        // Multi-agent task: create worktrees for each provider×runs combo
        const variants: Array<{
          id: string;
          provider: Provider;
          name: string;
          branch: string;
          path: string;
          worktreeId: string;
        }> = [];

        for (const { provider, runs } of providerRuns) {
          for (let instanceIdx = 1; instanceIdx <= runs; instanceIdx++) {
            const instanceSuffix = runs > 1 ? `-${instanceIdx}` : '';
            const variantName = `${taskName}-${provider.toLowerCase()}${instanceSuffix}`;
            const worktreeResult = await window.electronAPI.worktreeCreate({
              projectPath: selectedProject.path,
              taskName: variantName,
              projectId: selectedProject.id,
              autoApprove,
            });
            if (!worktreeResult?.success || !worktreeResult.worktree) {
              throw new Error(
                worktreeResult?.error ||
                  `Failed to create worktree for ${provider}${instanceSuffix}`
              );
            }
            const worktree = worktreeResult.worktree;
            variants.push({
              id: `${taskName}-${provider.toLowerCase()}${instanceSuffix}`,
              provider: provider,
              name: variantName,
              branch: worktree.branch,
              path: worktree.path,
              worktreeId: worktree.id,
            });
          }
        }

        const multiMeta: TaskMetadata = {
          ...(taskMetadata || {}),
          multiAgent: {
            enabled: true,
            maxProviders: 4,
            providerRuns,
            variants,
            selectedProvider: null,
          },
        };

        const groupId = `ws-${taskName}-${Date.now()}`;
        newTask = {
          id: groupId,
          projectId: selectedProject.id,
          name: taskName,
          branch: variants[0]?.branch || selectedProject.gitInfo.branch || 'main',
          path: variants[0]?.path || selectedProject.path,
          status: 'idle',
          agentId: primaryProvider,
          metadata: multiMeta,
        };

        const saveResult = await window.electronAPI.saveTask({
          ...newTask,
          agentId: primaryProvider,
          metadata: multiMeta,
        });
        if (!saveResult?.success) {
          const { log } = await import('./lib/logger');
          log.error('Failed to save multi-agent task:', saveResult?.error);
          toast({ title: 'Error', description: 'Failed to create multi-agent task.' });
          setIsCreatingTask(false);
          return;
        }
      } else {
        // Create worktree
        const worktreeResult = await window.electronAPI.worktreeCreate({
          projectPath: selectedProject.path,
          taskName,
          projectId: selectedProject.id,
          autoApprove,
        });

        if (!worktreeResult.success) {
          throw new Error(worktreeResult.error || 'Failed to create worktree');
        }

        const worktree = worktreeResult.worktree;

        newTask = {
          id: worktree.id,
          projectId: selectedProject.id,
          name: taskName,
          branch: worktree.branch,
          path: worktree.path,
          status: 'idle',
          agentId: primaryProvider,
          metadata: taskMetadata,
        };

        const saveResult = await window.electronAPI.saveTask({
          ...newTask,
          agentId: primaryProvider,
          metadata: taskMetadata,
        });
        if (!saveResult?.success) {
          const { log } = await import('./lib/logger');
          log.error('Failed to save task:', saveResult?.error);
          toast({ title: 'Error', description: 'Failed to create task.' });
          setIsCreatingTask(false);
          return;
        }
      }

      {
        if (taskMetadata?.linearIssue) {
          try {
            const convoResult = await window.electronAPI.getOrCreateDefaultConversation(newTask.id);

            if (convoResult?.success && convoResult.conversation?.id) {
              const issue = taskMetadata.linearIssue;
              const detailParts: string[] = [];
              const stateName = issue.state?.name?.trim();
              const assigneeName =
                issue.assignee?.displayName?.trim() || issue.assignee?.name?.trim();
              const teamKey = issue.team?.key?.trim();
              const projectName = issue.project?.name?.trim();

              if (stateName) detailParts.push(`State: ${stateName}`);
              if (assigneeName) detailParts.push(`Assignee: ${assigneeName}`);
              if (teamKey) detailParts.push(`Team: ${teamKey}`);
              if (projectName) detailParts.push(`Project: ${projectName}`);

              const lines = [`Linked Linear issue: ${issue.identifier} — ${issue.title}`];

              if (detailParts.length) {
                lines.push(`Details: ${detailParts.join(' • ')}`);
              }

              if (issue.url) {
                lines.push(`URL: ${issue.url}`);
              }

              if ((issue as any)?.description) {
                lines.push('');
                lines.push('Issue Description:');
                lines.push(String((issue as any).description).trim());
              }

              await window.electronAPI.saveMessage({
                id: `linear-context-${newTask.id}`,
                conversationId: convoResult.conversation.id,
                content: lines.join('\n'),
                sender: 'agent',
                metadata: JSON.stringify({
                  isLinearContext: true,
                  linearIssue: issue,
                }),
              });
            }
          } catch (seedError) {
            const { log } = await import('./lib/logger');
            log.error('Failed to seed task with Linear issue context:', seedError as any);
          }
        }
        if (taskMetadata?.githubIssue) {
          try {
            const convoResult = await window.electronAPI.getOrCreateDefaultConversation(newTask.id);

            if (convoResult?.success && convoResult.conversation?.id) {
              const issue = taskMetadata.githubIssue;
              const detailParts: string[] = [];
              const stateName = issue.state?.toString()?.trim();
              const assignees = Array.isArray(issue.assignees)
                ? issue.assignees
                    .map((a) => a?.name || a?.login)
                    .filter(Boolean)
                    .join(', ')
                : '';
              const labels = Array.isArray(issue.labels)
                ? issue.labels
                    .map((l) => l?.name)
                    .filter(Boolean)
                    .join(', ')
                : '';
              if (stateName) detailParts.push(`State: ${stateName}`);
              if (assignees) detailParts.push(`Assignees: ${assignees}`);
              if (labels) detailParts.push(`Labels: ${labels}`);

              const lines = [`Linked GitHub issue: #${issue.number} — ${issue.title}`];

              if (detailParts.length) {
                lines.push(`Details: ${detailParts.join(' • ')}`);
              }

              if (issue.url) {
                lines.push(`URL: ${issue.url}`);
              }

              if ((issue as any)?.body) {
                lines.push('');
                lines.push('Issue Description:');
                lines.push(String((issue as any).body).trim());
              }

              await window.electronAPI.saveMessage({
                id: `github-context-${newTask.id}`,
                conversationId: convoResult.conversation.id,
                content: lines.join('\n'),
                sender: 'agent',
                metadata: JSON.stringify({
                  isGitHubContext: true,
                  githubIssue: issue,
                }),
              });
            }
          } catch (seedError) {
            const { log } = await import('./lib/logger');
            log.error('Failed to seed task with GitHub issue context:', seedError as any);
          }
        }
        if (taskMetadata?.jiraIssue) {
          try {
            const convoResult = await window.electronAPI.getOrCreateDefaultConversation(newTask.id);

            if (convoResult?.success && convoResult.conversation?.id) {
              const issue: any = taskMetadata.jiraIssue;
              const lines: string[] = [];
              const line1 =
                `Linked Jira issue: ${issue.key || ''}${issue.summary ? ` — ${issue.summary}` : ''}`.trim();
              if (line1) lines.push(line1);

              const details: string[] = [];
              if (issue.status?.name) details.push(`Status: ${issue.status.name}`);
              if (issue.assignee?.displayName || issue.assignee?.name)
                details.push(`Assignee: ${issue.assignee?.displayName || issue.assignee?.name}`);
              if (issue.project?.key) details.push(`Project: ${issue.project.key}`);
              if (details.length) lines.push(`Details: ${details.join(' • ')}`);
              if (issue.url) lines.push(`URL: ${issue.url}`);

              await window.electronAPI.saveMessage({
                id: `jira-context-${newTask.id}`,
                conversationId: convoResult.conversation.id,
                content: lines.join('\n'),
                sender: 'agent',
                metadata: JSON.stringify({
                  isJiraContext: true,
                  jiraIssue: issue,
                }),
              });
            }
          } catch (seedError) {
            const { log } = await import('./lib/logger');
            log.error('Failed to seed task with Jira issue context:', seedError as any);
          }
        }

        setProjects((prev) =>
          prev.map((project) =>
            project.id === selectedProject.id
              ? {
                  ...project,
                  tasks: [newTask, ...(project.tasks || [])],
                }
              : project
          )
        );

        setSelectedProject((prev) =>
          prev
            ? {
                ...prev,
                tasks: [newTask, ...(prev.tasks || [])],
              }
            : null
        );

        // Track task creation
        const { captureTelemetry } = await import('./lib/telemetryClient');
        const isMultiAgent = (newTask.metadata as any)?.multiAgent?.enabled;
        captureTelemetry('task_created', {
          provider: isMultiAgent ? 'multi' : (newTask.agentId as string) || 'codex',
          has_initial_prompt: !!taskMetadata?.initialPrompt,
        });

        // Set the active task and its provider (none if multi-agent)
        setActiveTask(newTask);
        if ((newTask.metadata as any)?.multiAgent?.enabled) {
          setActiveTaskProvider(null);
        } else {
          // Use the saved agentId from the task, which should match primaryProvider
          setActiveTaskProvider((newTask.agentId as Provider) || primaryProvider || 'codex');
        }
      }
    } catch (error) {
      const { log } = await import('./lib/logger');
      log.error('Failed to create task:', error as any);
      toast({
        title: 'Error',
        description:
          (error as Error)?.message ||
          'Failed to create task. Please check the console for details.',
      });
    } finally {
      setIsCreatingTask(false);
    }
  };

  const handleGoHome = () => {
    setSelectedProject(null);
    setShowHomeView(true);
    setActiveTask(null);
  };

  const handleSelectProject = (project: Project) => {
    activateProjectView(project);
  };

  const handleSelectTask = (task: Task) => {
    setActiveTask(task);
    // Load provider from task.agentId if it exists, otherwise default to null
    // This ensures the selected provider persists across app restarts
    if ((task.metadata as any)?.multiAgent?.enabled) {
      setActiveTaskProvider(null);
    } else {
      // Use agentId from task if available, otherwise fall back to 'codex' for backwards compatibility
      setActiveTaskProvider((task.agentId as Provider) || 'codex');
    }
  };

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

    if (wasActive) {
      setActiveTask(null);
      setActiveTaskProvider(null);
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
        try {
          // Clear initial prompt sent flags (legacy and per-provider) if present
          const { initialPromptSentKey } = await import('./lib/keys');
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

        const [removeResult, deleteResult] = await Promise.allSettled([
          window.electronAPI.worktreeRemove({
            projectPath: targetProject.path,
            worktreeId: task.id,
            worktreePath: task.path,
            branch: task.branch,
          }),
          window.electronAPI.deleteTask(task.id),
        ]);

        if (removeResult.status !== 'fulfilled' || !removeResult.value?.success) {
          const errorMsg =
            removeResult.status === 'fulfilled'
              ? removeResult.value?.error || 'Failed to remove worktree'
              : removeResult.reason?.message || String(removeResult.reason);
          throw new Error(errorMsg);
        }

        if (deleteResult.status !== 'fulfilled' || !deleteResult.value?.success) {
          const errorMsg =
            deleteResult.status === 'fulfilled'
              ? deleteResult.value?.error || 'Failed to delete task'
              : deleteResult.reason?.message || String(deleteResult.reason);
          throw new Error(errorMsg);
        }

        // Track task deletion
        const { captureTelemetry } = await import('./lib/telemetryClient');
        captureTelemetry('task_deleted');

        if (!options?.silent) {
          toast({
            title: 'Task deleted',
            description: task.name,
          });
        }
        return true;
      } catch (error) {
        const { log } = await import('./lib/logger');
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

  const needsGhInstall = isGithubInitialized && !ghInstalled;
  const needsGhAuth = isGithubInitialized && ghInstalled && !isAuthenticated;

  const handleReorderProjectsFull = (newOrder: Project[]) => {
    setProjects(() => {
      const list = [...newOrder];
      saveProjectOrder(list);
      return list;
    });
  };

  const handleDeleteProject = async (project: Project) => {
    try {
      const res = await window.electronAPI.deleteProject(project.id);
      if (!res?.success) throw new Error(res?.error || 'Failed to delete project');

      const { captureTelemetry } = await import('./lib/telemetryClient');
      captureTelemetry('project_deleted');
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
        setActiveTask(null);
        setShowHomeView(true);
      }
      toast({ title: 'Project deleted', description: `"${project.name}" was removed.` });
    } catch (err) {
      const { log } = await import('./lib/logger');
      log.error('Delete project failed:', err as any);
      toast({
        title: 'Error',
        description:
          err instanceof Error ? err.message : 'Could not delete project. See console for details.',
        variant: 'destructive',
      });
    }
  };

  const [showKanban, setShowKanban] = useState<boolean>(false);
  const handleToggleKanban = useCallback(() => {
    if (!selectedProject) return;
    setShowKanban((v) => !v);
  }, [selectedProject]);

  const handleDeviceFlowSuccess = useCallback(
    async (user: any) => {
      setShowDeviceFlowModal(false);

      // Refresh status immediately to update UI
      await checkStatus();

      // Also refresh again after a short delay to catch user info if it arrives quickly
      setTimeout(async () => {
        await checkStatus();
      }, 500);

      toast({
        title: 'Connected to GitHub',
        description: `Signed in as ${user?.login || user?.name || 'user'}`,
      });
    },
    [checkStatus, toast]
  );

  const handleDeviceFlowError = useCallback(
    (error: string) => {
      setShowDeviceFlowModal(false);

      toast({
        title: 'Authentication Failed',
        description: error,
        variant: 'destructive',
      });
    },
    [toast]
  );

  const handleDeviceFlowClose = useCallback(() => {
    setShowDeviceFlowModal(false);
  }, []);

  // Subscribe to GitHub auth events from main process
  useEffect(() => {
    const cleanupSuccess = window.electronAPI.onGithubAuthSuccess((data) => {
      handleDeviceFlowSuccess(data.user);
    });

    const cleanupError = window.electronAPI.onGithubAuthError((data) => {
      handleDeviceFlowError(data.message || data.error);
    });

    // Listen for user info update (arrives after token is stored and gh CLI is authenticated)
    const cleanupUserUpdated = window.electronAPI.onGithubAuthUserUpdated(async () => {
      // Refresh status when user info becomes available
      await checkStatus();
    });

    return () => {
      cleanupSuccess();
      cleanupError();
      cleanupUserUpdated();
    };
  }, [handleDeviceFlowSuccess, handleDeviceFlowError, checkStatus]);

  const renderMainContent = () => {
    if (selectedProject && showKanban) {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <KanbanBoard
            project={selectedProject}
            onOpenTask={(ws: any) => {
              handleSelectTask(ws);
              setShowKanban(false);
            }}
            onCreateTask={() => setShowTaskModal(true)}
          />
        </div>
      );
    }
    if (showHomeView) {
      return (
        <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
          <div className="container mx-auto flex min-h-full max-w-3xl flex-1 flex-col justify-center px-8 py-8">
            <div className="mb-6 text-center">
              <div className="mb-2 flex items-center justify-center">
                <div className="logo-shimmer-container">
                  <img
                    key={effectiveTheme}
                    src={effectiveTheme === 'dark' ? emdashLogoWhite : emdashLogo}
                    alt="Emdash"
                    className="logo-shimmer-image"
                  />
                  <span
                    className="logo-shimmer-overlay"
                    aria-hidden="true"
                    style={{
                      WebkitMaskImage: `url(${effectiveTheme === 'dark' ? emdashLogoWhite : emdashLogo})`,
                      maskImage: `url(${effectiveTheme === 'dark' ? emdashLogoWhite : emdashLogo})`,
                      WebkitMaskRepeat: 'no-repeat',
                      maskRepeat: 'no-repeat',
                      WebkitMaskSize: 'contain',
                      maskSize: 'contain',
                      WebkitMaskPosition: 'center',
                      maskPosition: 'center',
                    }}
                  />
                </div>
              </div>
              <p className="whitespace-nowrap text-xs text-muted-foreground">
                Run multiple Coding Agents in parallel
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-2">
              <motion.button
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.1, ease: 'easeInOut' }}
                onClick={() => {
                  void (async () => {
                    const { captureTelemetry } = await import('./lib/telemetryClient');
                    captureTelemetry('project_open_clicked');
                  })();
                  handleOpenProject();
                }}
                className="group flex flex-col items-start justify-between rounded-lg border border-border bg-muted/20 p-4 text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <FolderOpen className="mb-5 h-5 w-5 text-foreground opacity-70" />
                <div className="w-full min-w-0 text-left">
                  <h3 className="truncate text-xs font-semibold">Open project</h3>
                </div>
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.1, ease: 'easeInOut' }}
                onClick={() => {
                  void (async () => {
                    const { captureTelemetry } = await import('./lib/telemetryClient');
                    captureTelemetry('project_create_clicked');
                  })();
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
                }}
                className="group flex flex-col items-start justify-between rounded-lg border border-border bg-muted/20 p-4 text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Plus className="mb-5 h-5 w-5 text-foreground opacity-70" />
                <div className="w-full min-w-0 text-left">
                  <h3 className="truncate text-xs font-semibold">Create New Project</h3>
                </div>
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.1, ease: 'easeInOut' }}
                onClick={() => {
                  void (async () => {
                    const { captureTelemetry } = await import('./lib/telemetryClient');
                    captureTelemetry('project_clone_clicked');
                  })();
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
                }}
                className="group flex flex-col items-start justify-between rounded-lg border border-border bg-muted/20 p-4 text-card-foreground shadow-sm transition-all hover:bg-muted/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Github className="mb-5 h-5 w-5 text-foreground opacity-70" />
                <div className="w-full min-w-0 text-left">
                  <h3 className="truncate text-xs font-semibold">Clone from GitHub</h3>
                </div>
              </motion.button>
            </div>
          </div>
        </div>
      );
    }

    if (selectedProject) {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeTask ? (
            (activeTask.metadata as any)?.multiAgent?.enabled ? (
              <MultiAgentTask
                task={activeTask}
                projectName={selectedProject.name}
                projectId={selectedProject.id}
              />
            ) : (
              <ChatInterface
                task={activeTask}
                projectName={selectedProject.name}
                className="min-h-0 flex-1"
                initialProvider={activeTaskProvider || undefined}
              />
            )
          ) : (
            <ProjectMainView
              project={selectedProject}
              onCreateTask={() => setShowTaskModal(true)}
              activeTask={activeTask}
              onSelectTask={handleSelectTask}
              onDeleteTask={handleDeleteTask}
              isCreatingTask={isCreatingTask}
              onDeleteProject={handleDeleteProject}
            />
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <BrowserProvider>
      <div
        className="flex h-[100dvh] w-full flex-col bg-background text-foreground"
        style={{ '--tb': TITLEBAR_HEIGHT } as React.CSSProperties}
      >
        {(() => {
          // Track Kanban locally in this component scope
          return null;
        })()}
        <SidebarProvider>
          <RightSidebarProvider>
            <AppKeyboardShortcuts
              showCommandPalette={showCommandPalette}
              showSettings={showSettings}
              handleToggleCommandPalette={handleToggleCommandPalette}
              handleOpenSettings={handleOpenSettings}
              handleCloseCommandPalette={handleCloseCommandPalette}
              handleCloseSettings={handleCloseSettings}
              handleToggleKanban={handleToggleKanban}
              handleOpenFeedback={handleOpenFeedback}
            />
            <RightSidebarBridge
              onCollapsedChange={handleRightSidebarCollapsedChange}
              setCollapsedRef={rightSidebarSetCollapsedRef}
            />
            <Titlebar
              currentPath={
                activeTask?.metadata?.multiAgent?.enabled
                  ? null
                  : activeTask?.path || selectedProject?.path || null
              }
              defaultPreviewUrl={
                activeTask?.id ? getContainerRunState(activeTask.id)?.previewUrl || null : null
              }
              taskId={activeTask?.id || null}
              taskPath={activeTask?.path || null}
              projectPath={selectedProject?.path || null}
              isTaskMultiAgent={Boolean(activeTask?.metadata?.multiAgent?.enabled)}
              onToggleKanban={handleToggleKanban}
              isKanbanOpen={Boolean(showKanban)}
              kanbanAvailable={Boolean(selectedProject)}
              platform={platform}
              isFullscreen={isFullscreen}
            />
            <div className="flex flex-1 overflow-hidden pt-[var(--tb)]">
              <ResizablePanelGroup
                direction="horizontal"
                className="flex-1 overflow-hidden"
                onLayout={handlePanelLayout}
              >
                <ResizablePanel
                  ref={leftSidebarPanelRef}
                  className="sidebar-panel sidebar-panel--left"
                  defaultSize={defaultPanelLayout[0]}
                  minSize={LEFT_SIDEBAR_MIN_SIZE}
                  maxSize={LEFT_SIDEBAR_MAX_SIZE}
                  collapsedSize={0}
                  collapsible
                  order={1}
                >
                  <LeftSidebar
                    projects={projects}
                    selectedProject={selectedProject}
                    onSelectProject={handleSelectProject}
                    onGoHome={handleGoHome}
                    onOpenProject={handleOpenProject}
                    onNewProject={() => setShowNewProjectModal(true)}
                    onSelectTask={handleSelectTask}
                    activeTask={activeTask || undefined}
                    onReorderProjects={handleReorderProjects}
                    onReorderProjectsFull={handleReorderProjectsFull}
                    githubInstalled={ghInstalled}
                    githubAuthenticated={isAuthenticated}
                    githubUser={user}
                    onGithubConnect={handleGithubConnect}
                    githubLoading={githubLoading}
                    githubStatusMessage={githubStatusMessage}
                    githubInitialized={isGithubInitialized}
                    onSidebarContextChange={handleSidebarContextChange}
                    onCreateTaskForProject={handleStartCreateTaskFromSidebar}
                    isCreatingTask={isCreatingTask}
                    onDeleteTask={handleDeleteTask}
                    onDeleteProject={handleDeleteProject}
                    isHomeView={showHomeView}
                    onToggleSettings={handleToggleSettings}
                    isSettingsOpen={showSettings}
                    isFeedbackOpen={showFeedback}
                    onOpenFeedback={handleOpenFeedback}
                    onCloseFeedback={handleCloseFeedback}
                  />
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  className="hidden cursor-col-resize items-center justify-center transition-colors hover:bg-border/80 lg:flex"
                />
                <ResizablePanel
                  className="sidebar-panel sidebar-panel--main"
                  defaultSize={defaultPanelLayout[1]}
                  minSize={MAIN_PANEL_MIN_SIZE}
                  order={2}
                >
                  <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
                    {renderMainContent()}
                  </div>
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  className="hidden cursor-col-resize items-center justify-center transition-colors hover:bg-border/80 lg:flex"
                />
                <ResizablePanel
                  ref={rightSidebarPanelRef}
                  className="sidebar-panel sidebar-panel--right"
                  defaultSize={0}
                  minSize={RIGHT_SIDEBAR_MIN_SIZE}
                  maxSize={RIGHT_SIDEBAR_MAX_SIZE}
                  collapsedSize={0}
                  collapsible
                  order={3}
                >
                  <RightSidebar
                    task={activeTask}
                    projectPath={selectedProject?.path || null}
                    className="lg:border-l-0"
                  />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
            <SettingsModal isOpen={showSettings} onClose={handleCloseSettings} />
            <CommandPaletteWrapper
              isOpen={showCommandPalette}
              onClose={handleCloseCommandPalette}
              projects={projects}
              handleSelectProject={handleSelectProject}
              handleSelectTask={handleSelectTask}
              handleGoHome={handleGoHome}
              handleOpenProject={handleOpenProject}
              handleOpenSettings={handleOpenSettings}
            />
            <TaskModal
              isOpen={showTaskModal}
              onClose={() => setShowTaskModal(false)}
              onCreateTask={handleCreateTask}
              projectName={selectedProject?.name || ''}
              defaultBranch={selectedProject?.gitInfo.branch || 'main'}
              existingNames={(selectedProject?.tasks || []).map((w) => w.name)}
              projectPath={selectedProject?.path}
            />
            <NewProjectModal
              isOpen={showNewProjectModal}
              onClose={() => setShowNewProjectModal(false)}
              onSuccess={handleNewProjectSuccess}
            />
            <CloneFromUrlModal
              isOpen={showCloneModal}
              onClose={() => setShowCloneModal(false)}
              onSuccess={handleCloneSuccess}
            />
            <FirstLaunchModal open={showFirstLaunchModal} onClose={markFirstLaunchSeen} />
            <GithubDeviceFlowModal
              open={showDeviceFlowModal}
              onClose={handleDeviceFlowClose}
              onSuccess={handleDeviceFlowSuccess}
              onError={handleDeviceFlowError}
            />
            <Toaster />
            <BrowserPane
              taskId={activeTask?.id || null}
              taskPath={activeTask?.path || null}
              overlayActive={
                showSettings || showCommandPalette || showTaskModal || showFirstLaunchModal
              }
            />
          </RightSidebarProvider>
        </SidebarProvider>
      </div>
    </BrowserProvider>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </ThemeProvider>
  );
};

export default App;
