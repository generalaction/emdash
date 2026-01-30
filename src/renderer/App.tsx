import { motion } from 'framer-motion';
import { FolderOpen, Github, Plus } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { WelcomeScreen } from './components/WelcomeScreen';
import { GithubDeviceFlowModal } from './components/GithubDeviceFlowModal';
import KanbanBoard from './components/kanban/KanbanBoard';
import LeftSidebar from './components/LeftSidebar';
import MultiAgentTask from './components/MultiAgentTask';
import { NewProjectModal } from './components/NewProjectModal';
import ProjectMainView from './components/ProjectMainView';
import RightSidebar from './components/RightSidebar';
import CodeEditor from './components/FileExplorer/CodeEditor';
import SettingsModal from './components/SettingsModal';
import TaskModal from './components/TaskModal';
import { pickDefaultBranch } from './components/BranchSelect';
import { ThemeProvider } from './components/ThemeProvider';
import Titlebar from './components/titlebar/Titlebar';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/resizable';
import { RightSidebarProvider, useRightSidebar } from './components/ui/right-sidebar';
import { SidebarProvider } from './components/ui/sidebar';
import { KeyboardSettingsProvider } from './contexts/KeyboardSettingsContext';
import { ToastAction } from './components/ui/toast';
import { Toaster } from './components/ui/toaster';
import { useToast } from './hooks/use-toast';
import { useGithubAuth } from './hooks/useGithubAuth';
import { useTheme } from './hooks/useTheme';
import useUpdateNotifier from './hooks/useUpdateNotifier';
import { loadPanelSizes, savePanelSizes } from './lib/persisted-layout';
import { disposeTaskTerminals } from './lib/taskTerminalsStore';
import { clearSetupScriptState } from './components/TaskTerminalPanel';
import {
  computeBaseRef,
  getProjectRepoKey,
  normalizePathForComparison,
  withRepoKey,
} from './lib/projectUtils';
import { BrowserProvider } from './providers/BrowserProvider';
import { terminalSessionRegistry } from './terminal/SessionRegistry';
import { type Agent } from './types';
import type { Project, Task } from './types/app';
import type { TaskMetadata } from './types/chat';
import { type GitHubIssueSummary } from './types/github';
import { type GitHubIssueLink } from './types/chat';
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
const ACTIVE_PROJECT_KEY = 'emdash:activeProjectId';
const ACTIVE_TASK_KEY = 'emdash:activeTaskId';

const getStoredActiveIds = (): { projectId: string | null; taskId: string | null } => {
  try {
    return {
      projectId: localStorage.getItem(ACTIVE_PROJECT_KEY),
      taskId: localStorage.getItem(ACTIVE_TASK_KEY),
    };
  } catch {
    return { projectId: null, taskId: null };
  }
};

const saveActiveIds = (projectId: string | null, taskId: string | null): void => {
  try {
    if (projectId) {
      localStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
    if (taskId) {
      localStorage.setItem(ACTIVE_TASK_KEY, taskId);
    } else {
      localStorage.removeItem(ACTIVE_TASK_KEY);
    }
  } catch {}
};

const getAgentForTask = (task: Task): Agent | null => {
  if ((task.metadata as any)?.multiAgent?.enabled) {
    return null;
  }
  return (task.agentId as Agent) || 'codex';
};

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
  // Initialize theme on app startup
  const { effectiveTheme } = useTheme();

  const { toast } = useToast();
  const [_, setVersion] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');
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
  const [archivedTasksVersion, setArchivedTasksVersion] = useState(0);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showEditorMode, setShowEditorMode] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState<boolean>(false);
  // Branch options (loaded when project is selected)
  const [projectBranchOptions, setProjectBranchOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [projectDefaultBranch, setProjectDefaultBranch] = useState<string>('main');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState<boolean>(false);
  const [showCloneModal, setShowCloneModal] = useState<boolean>(false);
  // Read stored active IDs synchronously to prevent flash on reload
  const storedActiveIds = useMemo(() => getStoredActiveIds(), []);
  const hasPendingRestore = storedActiveIds.projectId !== null;
  // Start with showHomeView=false if we have a pending restore to prevent flash
  const [showHomeView, setShowHomeView] = useState<boolean>(!hasPendingRestore);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskAgent, setActiveTaskAgent] = useState<Agent | null>(null);
  // Track whether initial restore has completed to defer sidebar auto-behavior
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showWelcomeScreen, setShowWelcomeScreen] = useState<boolean>(false);
  const [showFirstLaunchModal, setShowFirstLaunchModal] = useState<boolean>(false);
  const deletingTaskIdsRef = useRef<Set<string>>(new Set());
  const restoringTaskIdsRef = useRef<Set<string>>(new Set());
  const archivingTaskIdsRef = useRef<Set<string>>(new Set());

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
  const leftSidebarWasCollapsedBeforeEditor = useRef<boolean>(false);
  const lastRightSidebarSizeRef = useRef<number>(rightSidebarDefaultWidth);
  const leftSidebarSetOpenRef = useRef<((next: boolean) => void) | null>(null);
  const leftSidebarIsMobileRef = useRef<boolean>(false);
  const leftSidebarOpenRef = useRef<boolean>(true);
  const rightSidebarSetCollapsedRef = useRef<((next: boolean) => void) | null>(null);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState<boolean>(false);
  const [autoRightSidebarBehavior, setAutoRightSidebarBehavior] = useState<boolean>(false);

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

      // Prevent sidebar from opening when in editor mode
      if (showEditorMode && open) {
        setOpen(false);
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
    [showEditorMode]
  );

  const activateProjectView = useCallback((project: Project) => {
    void (async () => {
      const { captureTelemetry } = await import('./lib/telemetryClient');
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

  const handleToggleCommandPalette = useCallback(() => {
    setShowCommandPalette((prev) => !prev);
  }, []);

  const handleCloseCommandPalette = useCallback(() => {
    setShowCommandPalette(false);
  }, []);

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

  // Agent switching handlers - dispatch custom events for ChatInterface to handle
  const handleNextAgent = useCallback(() => {
    if (!activeTask) return;
    window.dispatchEvent(new CustomEvent('emdash:switch-agent', { detail: { direction: 'next' } }));
  }, [activeTask]);

  const handlePrevAgent = useCallback(() => {
    if (!activeTask) return;
    window.dispatchEvent(new CustomEvent('emdash:switch-agent', { detail: { direction: 'prev' } }));
  }, [activeTask]);

  const handleWelcomeGetStarted = useCallback(() => {
    setShowWelcomeScreen(false);
    setShowFirstLaunchModal(true);
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

  // Handle left sidebar visibility when Editor mode changes
  useEffect(() => {
    const panel = leftSidebarPanelRef.current;
    if (!panel) return;

    if (showEditorMode) {
      // Store current collapsed state before hiding
      leftSidebarWasCollapsedBeforeEditor.current = panel.isCollapsed();
      // Collapse the left sidebar when Editor mode opens
      if (!panel.isCollapsed()) {
        panel.collapse();
      }
    } else {
      // Restore previous state when Editor mode closes
      if (!leftSidebarWasCollapsedBeforeEditor.current && panel.isCollapsed()) {
        panel.expand();
      }
    }
  }, [showEditorMode]);

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
      // Show WelcomeScreen for first-time users
      setShowWelcomeScreen(true);
    };
    void check();
  }, []);

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

  // Load autoRightSidebarBehavior setting on mount and listen for changes
  useEffect(() => {
    (async () => {
      try {
        const result = await window.electronAPI.getSettings();
        if (result.success && result.settings) {
          setAutoRightSidebarBehavior(
            Boolean(result.settings.interface?.autoRightSidebarBehavior ?? false)
          );
        }
      } catch (error) {
        console.error('Failed to load right sidebar settings:', error);
      }
    })();

    // Listen for setting changes from RightSidebarSettingsCard
    const handleSettingChange = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled: boolean }>;
      setAutoRightSidebarBehavior(customEvent.detail.enabled);
    };
    window.addEventListener('autoRightSidebarBehaviorChanged', handleSettingChange);
    return () => {
      window.removeEventListener('autoRightSidebarBehaviorChanged', handleSettingChange);
    };
  }, []);

  // Auto-collapse/expand right sidebar based on current view
  useEffect(() => {
    // Defer sidebar behavior until initial load completes to prevent flash
    if (!autoRightSidebarBehavior || !isInitialLoadComplete) return;

    const isHomePage = showHomeView;
    const isRepoHomePage = selectedProject !== null && activeTask === null;
    const shouldCollapse = isHomePage || isRepoHomePage;

    if (shouldCollapse) {
      rightSidebarSetCollapsedRef.current?.(true);
    } else if (activeTask !== null) {
      rightSidebarSetCollapsedRef.current?.(false);
    }
  }, [autoRightSidebarBehavior, isInitialLoadComplete, showHomeView, selectedProject, activeTask]);

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
        const initialProjects = applyProjectOrder(projects.map((p) => withRepoKey(p, appPlatform)));
        setProjects(initialProjects);

        // Refresh GH status via hook
        checkStatus();

        const projectsWithTasks = await Promise.all(
          initialProjects.map(async (project) => {
            const tasks = await window.electronAPI.getTasks(project.id);
            return withRepoKey({ ...project, tasks }, appPlatform);
          })
        );
        const ordered = applyProjectOrder(projectsWithTasks);
        setProjects(ordered);

        // Restore active project/task from stored IDs (read synchronously at init)
        const { projectId: storedProjectId, taskId: storedTaskId } = storedActiveIds;
        if (storedProjectId) {
          const project = ordered.find((p) => p.id === storedProjectId);
          if (project) {
            setSelectedProject(project);
            setShowHomeView(false);
            if (storedTaskId) {
              const task = project.tasks?.find((t) => t.id === storedTaskId);
              if (task) {
                setActiveTask(task);
                setActiveTaskAgent(getAgentForTask(task));
              } else {
                // Task no longer exists, clear it
                saveActiveIds(storedProjectId, null);
              }
            }
          } else {
            // Project no longer exists, show home and clear stored state
            setShowHomeView(true);
            saveActiveIds(null, null);
          }
        }
        setIsInitialLoadComplete(true);
      } catch (error) {
        const { log } = await import('./lib/logger');
        log.error('Failed to load app data:', error as any);
        setShowHomeView(true);
        setIsInitialLoadComplete(true);
      }
    };

    loadAppData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                const { captureTelemetry } = await import('./lib/telemetryClient');
                captureTelemetry('project_added_success', { source: 'github' });
                setProjects((prev) => [...prev, projectWithGithub]);
                activateProjectView(projectWithGithub);
              } else {
                const { log } = await import('./lib/logger');
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
              const { captureTelemetry } = await import('./lib/telemetryClient');
              captureTelemetry('project_added_success', { source: 'local' });
              setProjects((prev) => [...prev, projectWithoutGithub]);
              activateProjectView(projectWithoutGithub);
            } else {
              const { log } = await import('./lib/logger');
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

  const handleNewProjectClick = async () => {
    const { captureTelemetry } = await import('./lib/telemetryClient');
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
    const { captureTelemetry } = await import('./lib/telemetryClient');
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
      const { captureTelemetry } = await import('./lib/telemetryClient');
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
              const { log } = await import('./lib/logger');
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
        const { log } = await import('./lib/logger');
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
      const { captureTelemetry } = await import('./lib/telemetryClient');
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
              const { log } = await import('./lib/logger');
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
        const { log } = await import('./lib/logger');
        log.error('Failed to load new project:', error);
        toast({
          title: 'Project Created',
          description: 'Repository created but failed to load. Please try opening it manually.',
          variant: 'destructive',
        });
      }
    },
    [projects, isAuthenticated, activateProjectView, platform, toast]
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
        if (platform === 'darwin') {
          installMessage = 'Installing GitHub CLI via Homebrew...';
        } else if (platform === 'linux') {
          installMessage = 'Installing GitHub CLI via apt...';
        } else if (platform === 'win32') {
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
    agentRuns: import('./types/chat').AgentRun[] = [{ agent: 'claude', runs: 1 }],
    linkedLinearIssue: LinearIssueSummary | null = null,
    linkedGithubIssue: GitHubIssueSummary | null = null,
    linkedJiraIssue: JiraIssueSummary | null = null,
    autoApprove?: boolean,
    useWorktree: boolean = true,
    baseRef?: string
  ) => {
    if (!selectedProject) return;
    try {
      // Build basic prompt without enrichment (enrichment happens in background later)
      // This makes task creation instant - user sees the task immediately
      let preparedPrompt: string | undefined = undefined;
      if (initialPrompt && initialPrompt.trim()) {
        const parts: string[] = [];
        // Add basic issue info without API enrichment
        if (linkedLinearIssue) {
          parts.push(`Linear: ${linkedLinearIssue.identifier} — ${linkedLinearIssue.title}`);
          if (linkedLinearIssue.url) parts.push(`URL: ${linkedLinearIssue.url}`);
          parts.push('');
        }
        if (linkedGithubIssue) {
          parts.push(`GitHub: #${linkedGithubIssue.number} — ${linkedGithubIssue.title}`);
          if (linkedGithubIssue.url) parts.push(`URL: ${linkedGithubIssue.url}`);
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
      const totalRuns = agentRuns.reduce((sum, ar) => sum + ar.runs, 0);
      const isMultiAgent = totalRuns > 1;
      const primaryAgent = agentRuns[0]?.agent || 'claude';

      let newTask: Task;
      if (isMultiAgent) {
        // Multi-agent task: show UI immediately with loading state, create worktrees in background
        const groupId = `ws-${taskName}-${Date.now()}`;

        // Create optimistic task with empty variants - triggers loading state in MultiAgentTask
        const optimisticMeta: TaskMetadata = {
          ...(taskMetadata || {}),
          multiAgent: {
            enabled: true,
            maxAgents: 4,
            agentRuns,
            variants: [], // Empty initially - shows loading spinner
            selectedAgent: null,
          },
        };

        newTask = {
          id: groupId,
          projectId: selectedProject.id,
          name: taskName,
          branch: selectedProject.gitInfo.branch || 'main',
          path: selectedProject.path,
          status: 'idle',
          agentId: primaryAgent,
          metadata: optimisticMeta,
          useWorktree,
        };

        // Helper to remove optimistic task on failure
        const removeOptimisticTask = () => {
          setProjects((prev) =>
            prev.map((project) =>
              project.id === selectedProject.id
                ? { ...project, tasks: project.tasks?.filter((t) => t.id !== groupId) }
                : project
            )
          );
          setSelectedProject((prev) =>
            prev ? { ...prev, tasks: prev.tasks?.filter((t) => t.id !== groupId) } : null
          );
          setActiveTask((current) => (current?.id === groupId ? null : current));
        };

        // Update UI immediately - shows MultiAgentTask with loading spinner
        setProjects((prev) =>
          prev.map((project) =>
            project.id === selectedProject.id
              ? { ...project, tasks: [newTask, ...(project.tasks || [])] }
              : project
          )
        );
        setSelectedProject((prev) =>
          prev ? { ...prev, tasks: [newTask, ...(prev.tasks || [])] } : null
        );
        setActiveTask(newTask);
        setActiveTaskAgent(null);
        saveActiveIds(newTask.projectId, newTask.id);

        // Create worktrees in background, then update task with real variants
        (async () => {
          const variants: Array<{
            id: string;
            agent: Agent;
            name: string;
            branch: string;
            path: string;
            worktreeId: string;
          }> = [];

          try {
            for (const { agent, runs } of agentRuns) {
              for (let instanceIdx = 1; instanceIdx <= runs; instanceIdx++) {
                const instanceSuffix = runs > 1 ? `-${instanceIdx}` : '';
                const variantName = `${taskName}-${agent.toLowerCase()}${instanceSuffix}`;

                let branch: string;
                let path: string;
                let worktreeId: string;

                if (useWorktree) {
                  const worktreeResult = await window.electronAPI.worktreeCreate({
                    projectPath: selectedProject.path,
                    taskName: variantName,
                    projectId: selectedProject.id,
                    baseRef,
                  });
                  if (!worktreeResult?.success || !worktreeResult.worktree) {
                    throw new Error(
                      worktreeResult?.error ||
                        `Failed to create worktree for ${agent}${instanceSuffix}`
                    );
                  }
                  const worktree = worktreeResult.worktree;
                  branch = worktree.branch;
                  path = worktree.path;
                  worktreeId = worktree.id;
                } else {
                  // Direct branch mode - use current project path and branch
                  branch = selectedProject.gitInfo.branch || 'main';
                  path = selectedProject.path;
                  worktreeId = `direct-${taskName}-${agent.toLowerCase()}${instanceSuffix}`;
                }

                variants.push({
                  id: `${taskName}-${agent.toLowerCase()}${instanceSuffix}`,
                  agent: agent,
                  name: variantName,
                  branch,
                  path,
                  worktreeId,
                });
              }
            }

            // Build final metadata with real variants
            const finalMeta: TaskMetadata = {
              ...(taskMetadata || {}),
              multiAgent: {
                enabled: true,
                maxAgents: 4,
                agentRuns,
                variants,
                selectedAgent: null,
              },
            };

            const finalTask: Task = {
              ...newTask,
              branch: variants[0]?.branch || selectedProject.gitInfo.branch || 'main',
              path: variants[0]?.path || selectedProject.path,
              metadata: finalMeta,
            };

            // Save to DB
            const saveResult = await window.electronAPI.saveTask({
              ...finalTask,
              agentId: primaryAgent,
              metadata: finalMeta,
              useWorktree,
            });

            if (!saveResult?.success) {
              const { log } = await import('./lib/logger');
              log.error('Failed to save multi-agent task:', saveResult?.error);
              // Clean up worktrees that were created before the save failed
              for (const variant of variants) {
                if (variant.worktreeId && !variant.worktreeId.startsWith('direct-')) {
                  window.electronAPI
                    .worktreeRemove({
                      projectPath: selectedProject.path,
                      worktreeId: variant.worktreeId,
                    })
                    .catch(() => {});
                }
              }
              toast({
                title: 'Error',
                description: 'Failed to save multi-agent task.',
                variant: 'destructive',
              });
              removeOptimisticTask();
              return;
            }

            // Update UI with final task containing real variants
            setProjects((prev) =>
              prev.map((project) =>
                project.id === selectedProject.id
                  ? {
                      ...project,
                      tasks: project.tasks?.map((t) => (t.id === groupId ? finalTask : t)),
                    }
                  : project
              )
            );
            setSelectedProject((prev) =>
              prev
                ? { ...prev, tasks: prev.tasks?.map((t) => (t.id === groupId ? finalTask : t)) }
                : null
            );
            setActiveTask((current) => (current?.id === groupId ? finalTask : current));
          } catch (error) {
            const { log } = await import('./lib/logger');
            log.error('Failed to create multi-agent worktrees:', error as Error);
            // Clean up any worktrees that were created before the failure
            for (const variant of variants) {
              if (variant.worktreeId && !variant.worktreeId.startsWith('direct-')) {
                window.electronAPI
                  .worktreeRemove({
                    projectPath: selectedProject.path,
                    worktreeId: variant.worktreeId,
                  })
                  .catch(() => {});
              }
            }
            toast({
              title: 'Error',
              description:
                error instanceof Error ? error.message : 'Failed to create multi-agent workspaces.',
              variant: 'destructive',
            });
            removeOptimisticTask();
          }
        })();

        // Telemetry
        import('./lib/telemetryClient').then(({ captureTelemetry }) => {
          captureTelemetry('task_created', {
            provider: 'multi',
            has_initial_prompt: !!taskMetadata?.initialPrompt,
          });
        });
      } else {
        let branch: string;
        let path: string;
        let taskId: string;

        if (useWorktree) {
          // Try to claim a pre-created reserve worktree (instant)
          const claimResult = await window.electronAPI.worktreeClaimReserve({
            projectId: selectedProject.id,
            projectPath: selectedProject.path,
            taskName,
            baseRef,
          });

          if (claimResult.success && claimResult.worktree) {
            const worktree = claimResult.worktree;
            branch = worktree.branch;
            path = worktree.path;
            taskId = worktree.id;

            // Warn if base ref switch failed
            if (claimResult.needsBaseRefSwitch) {
              toast({
                title: 'Warning',
                description: `Could not switch to ${baseRef}. Task created on default branch.`,
              });
            }
          } else {
            // Fallback (or forced): Create worktree
            const worktreeResult = await window.electronAPI.worktreeCreate({
              projectPath: selectedProject.path,
              taskName,
              projectId: selectedProject.id,
              baseRef,
            });

            if (!worktreeResult.success) {
              throw new Error(worktreeResult.error || 'Failed to create worktree');
            }

            const worktree = worktreeResult.worktree;
            branch = worktree.branch;
            path = worktree.path;
            taskId = worktree.id;
          }
        } else {
          // Direct branch mode - use current project path and branch
          branch = selectedProject.gitInfo.branch || 'main';
          path = selectedProject.path;
          taskId = `direct-${taskName}-${Date.now()}`;
        }

        newTask = {
          id: taskId,
          projectId: selectedProject.id,
          name: taskName,
          branch,
          path,
          status: 'idle',
          agentId: primaryAgent,
          metadata: taskMetadata,
          useWorktree,
        };

        // Optimistic UI update - show task immediately, save in background
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

        // Set the active task and its agent immediately
        setActiveTask(newTask);
        setActiveTaskAgent(getAgentForTask(newTask) ?? primaryAgent ?? 'codex');
        saveActiveIds(newTask.projectId, newTask.id);

        // Background: save to database (non-blocking)
        window.electronAPI
          .saveTask({
            ...newTask,
            agentId: primaryAgent,
            metadata: taskMetadata,
            useWorktree,
          })
          .then((saveResult) => {
            if (!saveResult?.success) {
              import('./lib/logger').then(({ log }) => {
                log.error('Failed to save task:', saveResult?.error);
              });
              // Warn user that task may not persist across restarts
              toast({
                title: 'Warning',
                description:
                  'Task created but may not persist after restart. Try again if it disappears.',
                variant: 'destructive',
              });
            }
          });

        // Background: telemetry (non-blocking)
        import('./lib/telemetryClient').then(({ captureTelemetry }) => {
          const isMultiAgent = (newTask.metadata as any)?.multiAgent?.enabled;
          captureTelemetry('task_created', {
            provider: isMultiAgent ? 'multi' : (newTask.agentId as string) || 'codex',
            has_initial_prompt: !!taskMetadata?.initialPrompt,
          });
        });

        // Background: seed conversation with issue context (non-blocking)
        // This runs after modal closes so user sees task immediately
        (async () => {
          const hasIssueContext =
            taskMetadata?.linearIssue || taskMetadata?.githubIssue || taskMetadata?.jiraIssue;
          let conversationId: string | undefined;

          if (hasIssueContext) {
            try {
              // Get or create default conversation only once
              const convoResult = await window.electronAPI.getOrCreateDefaultConversation(
                newTask.id
              );
              if (convoResult?.success && convoResult.conversation?.id) {
                conversationId = convoResult.conversation.id;
              }
            } catch (error) {
              const { log } = await import('./lib/logger');
              log.error('Failed to get or create default conversation:', error as any);
            }
          }

          if (conversationId && taskMetadata?.linearIssue) {
            try {
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
                conversationId,
                content: lines.join('\n'),
                sender: 'agent',
                metadata: JSON.stringify({
                  isLinearContext: true,
                  linearIssue: issue,
                }),
              });
            } catch (seedError) {
              const { log } = await import('./lib/logger');
              log.error('Failed to seed task with Linear issue context:', seedError as any);
            }
          }

          if (conversationId && taskMetadata?.githubIssue) {
            try {
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
                conversationId,
                content: lines.join('\n'),
                sender: 'agent',
                metadata: JSON.stringify({
                  isGitHubContext: true,
                  githubIssue: issue,
                }),
              });
            } catch (seedError) {
              const { log } = await import('./lib/logger');
              log.error('Failed to seed task with GitHub issue context:', seedError as any);
            }
          }

          if (conversationId && taskMetadata?.jiraIssue) {
            try {
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
                conversationId,
                content: lines.join('\n'),
                sender: 'agent',
                metadata: JSON.stringify({
                  isJiraContext: true,
                  jiraIssue: issue,
                }),
              });
            } catch (seedError) {
              const { log } = await import('./lib/logger');
              log.error('Failed to seed task with Jira issue context:', seedError as any);
            }
          }
        })();
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
    }
  };

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

  const handleSelectTask = (task: Task) => {
    setActiveTask(task);
    setActiveTaskAgent(getAgentForTask(task));
    saveActiveIds(task.projectId, task.id);
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
        // Kill main agent terminals
        // Single-agent: ${provider}-main-${task.id}
        // Multi-agent: ${variant.worktreeId}-main
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
            const id = `${provider}-main-${task.id}`;
            mainSessionIds.push(id);
            try {
              window.electronAPI.ptyKill?.(id);
            } catch {}
          }
        }

        // Kill chat agent terminals (agents added via "+")
        const chatSessionIds: string[] = [];
        try {
          const convResult = await window.electronAPI.getConversations(task.id);
          if (convResult.success && convResult.conversations) {
            for (const conv of convResult.conversations) {
              if (!conv.isMain && conv.provider) {
                const chatId = `${conv.provider}-chat-${conv.id}`;
                chatSessionIds.push(chatId);
                try {
                  window.electronAPI.ptyKill?.(chatId);
                } catch {}
              }
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

        // Clear setup script state so it runs again if task is recreated
        clearSetupScriptState(task.id);

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
      const { log } = await import('./lib/logger');
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
              const id = `${provider}-main-${task.id}`;
              mainSessionIds.push(id);
              try {
                window.electronAPI.ptyKill?.(id);
              } catch {}
            }
          }

          // Kill chat agent terminals
          const chatSessionIds: string[] = [];
          try {
            const convResult = await window.electronAPI.getConversations(task.id);
            if (convResult.success && convResult.conversations) {
              for (const conv of convResult.conversations) {
                if (!conv.isMain && conv.provider) {
                  const chatId = `${conv.provider}-chat-${conv.id}`;
                  chatSessionIds.push(chatId);
                  try {
                    window.electronAPI.ptyKill?.(chatId);
                  } catch {}
                }
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
          const { log } = await import('./lib/logger');
          log.error('Error cleaning up PTY resources during archive:', err as any);
        }
      };

      // Start cleanup in background
      cleanupPtyResources();

      try {
        const result = await window.electronAPI.archiveTask(task.id);

        if (!result?.success) {
          throw new Error(result?.error || 'Failed to archive task');
        }

        // Track task archive
        const { captureTelemetry } = await import('./lib/telemetryClient');
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
        const { log } = await import('./lib/logger');
        log.error('Failed to archive task:', error as any);

        // Restore task to UI on error
        let restored = false;
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
      const result = await window.electronAPI.restoreTask(task.id);

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to restore task');
      }

      // Refresh tasks to include the restored task
      let refreshed = false;
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
        refreshed = true;
      } catch (refreshError) {
        const { log } = await import('./lib/logger');
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
      }

      // Track task restore
      const { captureTelemetry } = await import('./lib/telemetryClient');
      captureTelemetry('task_restored');

      toast({
        title: 'Task restored',
        description: task.name,
      });
    } catch (error) {
      const { log } = await import('./lib/logger');
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
      // Clean up reserve worktree before deleting project
      await window.electronAPI.worktreeRemoveReserve({ projectId: project.id }).catch(() => {});

      const res = await window.electronAPI.deleteProject(project.id);
      if (!res?.success) throw new Error(res?.error || 'Failed to delete project');

      const { captureTelemetry } = await import('./lib/telemetryClient');
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
    setShowEditorMode(false);
    setShowKanban((v) => !v);
  }, [selectedProject]);

  const handleToggleEditor = useCallback(() => {
    setShowKanban(false);
    setShowEditorMode((v) => !v);
  }, []);

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

  const linkedGithubIssueMap = useMemo(
    () => buildLinkedGithubIssueMap(selectedProject?.tasks),
    [selectedProject?.tasks]
  );

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
            <div className="mb-3 text-center">
              <div className="mb-3 flex items-center justify-center">
                <div className="logo-shimmer-container">
                  <img
                    key={effectiveTheme}
                    src={
                      effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
                        ? emdashLogoWhite
                        : emdashLogo
                    }
                    alt="Emdash"
                    className="logo-shimmer-image"
                  />
                  <span
                    className="logo-shimmer-overlay"
                    aria-hidden="true"
                    style={{
                      WebkitMaskImage: `url(${effectiveTheme === 'dark' || effectiveTheme === 'dark-black' ? emdashLogoWhite : emdashLogo})`,
                      maskImage: `url(${effectiveTheme === 'dark' || effectiveTheme === 'dark-black' ? emdashLogoWhite : emdashLogo})`,
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
                Coding Agent Dashboard
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
                onClick={handleNewProjectClick}
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
                onClick={handleCloneProjectClick}
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
                initialAgent={activeTaskAgent || undefined}
              />
            )
          ) : (
            <ProjectMainView
              project={selectedProject}
              onCreateTask={() => setShowTaskModal(true)}
              activeTask={activeTask}
              onSelectTask={handleSelectTask}
              onDeleteTask={handleDeleteTask}
              onArchiveTask={handleArchiveTask}
              onDeleteProject={handleDeleteProject}
              branchOptions={projectBranchOptions}
              isLoadingBranches={isLoadingBranches}
              onBaseBranchChange={setProjectDefaultBranch}
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
        <KeyboardSettingsProvider>
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
                handleToggleEditor={handleToggleEditor}
                handleNextTask={handleNextTask}
                handlePrevTask={handlePrevTask}
                handleNewTask={handleNewTask}
                handleNextAgent={handleNextAgent}
                handlePrevAgent={handlePrevAgent}
              />
              <RightSidebarBridge
                onCollapsedChange={handleRightSidebarCollapsedChange}
                setCollapsedRef={rightSidebarSetCollapsedRef}
              />
              {!showWelcomeScreen && (
                <Titlebar
                  onToggleSettings={handleToggleSettings}
                  isSettingsOpen={showSettings}
                  currentPath={
                    activeTask?.metadata?.multiAgent?.enabled
                      ? null
                      : activeTask?.path || selectedProject?.path || null
                  }
                  defaultPreviewUrl={
                    null // Previously: getContainerRunState(activeTask.id)?.previewUrl - Removed: Docker feature
                  }
                  taskId={activeTask?.id || null}
                  taskPath={activeTask?.path || null}
                  projectPath={selectedProject?.path || null}
                  isTaskMultiAgent={Boolean(activeTask?.metadata?.multiAgent?.enabled)}
                  githubUser={user}
                  onToggleKanban={handleToggleKanban}
                  isKanbanOpen={Boolean(showKanban)}
                  kanbanAvailable={Boolean(selectedProject)}
                  onToggleEditor={handleToggleEditor}
                  showEditorButton={Boolean(activeTask)}
                  isEditorOpen={showEditorMode}
                  projects={projects}
                  selectedProject={selectedProject}
                  activeTask={activeTask}
                  onSelectProject={handleSelectProject}
                  onSelectTask={handleSelectTask}
                />
              )}
              <div
                className={`flex flex-1 overflow-hidden ${!showWelcomeScreen ? 'pt-[var(--tb)]' : ''}`}
              >
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
                    style={{ display: showEditorMode ? 'none' : undefined }}
                  >
                    <LeftSidebar
                      projects={projects}
                      archivedTasksVersion={archivedTasksVersion}
                      selectedProject={selectedProject}
                      onSelectProject={handleSelectProject}
                      onGoHome={handleGoHome}
                      onOpenProject={handleOpenProject}
                      onNewProject={handleNewProjectClick}
                      onCloneProject={handleCloneProjectClick}
                      onSelectTask={handleSelectTask}
                      activeTask={activeTask || undefined}
                      onReorderProjects={handleReorderProjects}
                      onReorderProjectsFull={handleReorderProjectsFull}
                      onSidebarContextChange={handleSidebarContextChange}
                      onCreateTaskForProject={handleStartCreateTaskFromSidebar}
                      onDeleteTask={handleDeleteTask}
                      onRenameTask={handleRenameTask}
                      onArchiveTask={handleArchiveTask}
                      onRestoreTask={handleRestoreTask}
                      onDeleteProject={handleDeleteProject}
                      isHomeView={showHomeView}
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
                      forceBorder={showEditorMode}
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
              {showEditorMode && activeTask && selectedProject && (
                <CodeEditor
                  taskPath={activeTask.path}
                  taskName={activeTask.name}
                  projectName={selectedProject.name}
                  onClose={() => setShowEditorMode(false)}
                />
              )}

              <TaskModal
                isOpen={showTaskModal}
                onClose={() => setShowTaskModal(false)}
                onCreateTask={handleCreateTask}
                projectName={selectedProject?.name || ''}
                defaultBranch={projectDefaultBranch}
                existingNames={(selectedProject?.tasks || []).map((w) => w.name)}
                linkedGithubIssueMap={linkedGithubIssueMap}
                projectPath={selectedProject?.path}
                branchOptions={projectBranchOptions}
                isLoadingBranches={isLoadingBranches}
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
              {showWelcomeScreen && <WelcomeScreen onGetStarted={handleWelcomeGetStarted} />}
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
                  showSettings ||
                  showCommandPalette ||
                  showTaskModal ||
                  showWelcomeScreen ||
                  showFirstLaunchModal
                }
              />
            </RightSidebarProvider>
          </SidebarProvider>
        </KeyboardSettingsProvider>
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
