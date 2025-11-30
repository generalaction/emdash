import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from './components/ui/button';
import { FolderOpen } from 'lucide-react';
import LeftSidebar from './components/LeftSidebar';
import ProjectMainView from './components/ProjectMainView';
import WorkspaceModal from './components/WorkspaceModal';
import ChatInterface from './components/ChatInterface';
import MultiAgentWorkspace from './components/MultiAgentWorkspace';
import { Toaster } from './components/ui/toaster';
import useUpdateNotifier from './hooks/useUpdateNotifier';
import RequirementsNotice from './components/RequirementsNotice';
import { useToast } from './hooks/use-toast';
import { useGithubAuth } from './hooks/useGithubAuth';
import { useTheme } from './hooks/useTheme';
import { ThemeProvider } from './components/ThemeProvider';
import ErrorBoundary from './components/ErrorBoundary';
import emdashLogo from '../assets/images/emdash/emdash_logo.svg';
import emdashLogoWhite from '../assets/images/emdash/emdash_logo_white.svg';
import Titlebar from './components/titlebar/Titlebar';
import { SidebarProvider } from './components/ui/sidebar';
import { RightSidebarProvider, useRightSidebar } from './components/ui/right-sidebar';
import RightSidebar from './components/RightSidebar';
import { type Provider } from './types';
import { type LinearIssueSummary } from './types/linear';
import { type GitHubIssueSummary } from './types/github';
import { type JiraIssueSummary } from './types/jira';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable';
import { loadPanelSizes, savePanelSizes } from './lib/persisted-layout';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import SettingsModal from './components/SettingsModal';
import CommandPaletteWrapper from './components/CommandPaletteWrapper';
import FirstLaunchModal from './components/FirstLaunchModal';
import type { Project, Workspace } from './types/app';
import type { WorkspaceMetadata as ChatWorkspaceMetadata } from './types/chat';
import AppKeyboardShortcuts from './components/AppKeyboardShortcuts';
import { usePlanToasts } from './hooks/usePlanToasts';
import { terminalSessionRegistry } from './terminal/SessionRegistry';
import BrowserPane from './components/BrowserPane';
import { BrowserProvider } from './providers/BrowserProvider';
import { getContainerRunState } from './lib/containerRuns';
import KanbanBoard from './components/kanban/KanbanBoard';

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

// Shared types
type WorkspaceMetadata = ChatWorkspaceMetadata;

const TITLEBAR_HEIGHT = '36px';
const PANEL_LAYOUT_STORAGE_KEY = 'emdash.layout.left-main-right.v2';
const DEFAULT_PANEL_LAYOUT: [number, number, number] = [20, 60, 20];
const LEFT_SIDEBAR_MIN_SIZE = 16;
const LEFT_SIDEBAR_MAX_SIZE = 30;
const FIRST_LAUNCH_KEY = 'emdash:first-launch:v1';
const RIGHT_SIDEBAR_MIN_SIZE = 16;
const RIGHT_SIDEBAR_MAX_SIZE = 30;
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
  const {
    installed: ghInstalled,
    authenticated: isAuthenticated,
    user,
    checkStatus,
  } = useGithubAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [showWorkspaceModal, setShowWorkspaceModal] = useState<boolean>(false);
  const [showHomeView, setShowHomeView] = useState<boolean>(true);
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState<boolean>(false);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [activeWorkspaceProvider, setActiveWorkspaceProvider] = useState<Provider | null>(null);
  const [installedProviders, setInstalledProviders] = useState<Record<string, boolean>>({});
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [showFirstLaunchModal, setShowFirstLaunchModal] = useState<boolean>(false);
  const showGithubRequirement = !ghInstalled || !isAuthenticated;
  // Show agent requirements block if we have status data and none of the CLI providers are detected locally.
  const showAgentRequirement =
    Object.keys(installedProviders).length > 0 &&
    Object.values(installedProviders).every((v) => v === false);
  const deletingWorkspaceIdsRef = useRef<Set<string>>(new Set());

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
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState<boolean>(true);

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
    setSelectedProject(project);
    setShowHomeView(false);
    setActiveWorkspace(null);
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

        const projectsWithWorkspaces = await Promise.all(
          initialProjects.map(async (project) => {
            const workspaces = await window.electronAPI.getWorkspaces(project.id);
            return withRepoKey({ ...project, workspaces });
          })
        );
        const ordered = applyProjectOrder(projectsWithWorkspaces);
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

  const handleOpenProject = async () => {
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
            workspaces: [],
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
                setProjects((prev) => [...prev, projectWithGithub]);
                activateProjectView(projectWithGithub);
              } else {
                const { log } = await import('./lib/logger');
                log.error('Failed to save project:', saveResult.error);
              }
            } else {
              const updateHint =
                platform === 'darwin'
                  ? 'Tip: Update GitHub CLI with: brew upgrade gh — then restart emdash.'
                  : platform === 'win32'
                    ? 'Tip: Update GitHub CLI with: winget upgrade GitHub.cli — then restart emdash.'
                    : 'Tip: Update GitHub CLI via your package manager (e.g., apt/dnf) and restart emdash.';
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

  const handleCreateWorkspace = async (
    workspaceName: string,
    initialPrompt?: string,
    selectedProvider?: Provider,
    linkedLinearIssue: LinearIssueSummary | null = null,
    linkedGithubIssue: GitHubIssueSummary | null = null,
    linkedJiraIssue: JiraIssueSummary | null = null,
    multiAgent: {
      enabled: boolean;
      providers: Provider[];
      maxProviders?: number;
      runsPerProvider?: number;
    } | null = null,
    autoApprove?: boolean
  ) => {
    if (!selectedProject) return;

    setIsCreatingWorkspace(true);
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

      const workspaceMetadata: WorkspaceMetadata | null =
        linkedLinearIssue || linkedJiraIssue || linkedGithubIssue || preparedPrompt || autoApprove
          ? {
              linearIssue: linkedLinearIssue ?? null,
              jiraIssue: linkedJiraIssue ?? null,
              githubIssue: linkedGithubIssue ?? null,
              initialPrompt: preparedPrompt ?? null,
              autoApprove: autoApprove ?? null,
            }
          : null;

      // Multi-agent or single-agent workspace creation
      const runsPerProvider = Math.max(1, multiAgent?.runsPerProvider || 1);
      const providerList = Array.isArray(multiAgent?.providers)
        ? multiAgent.providers.filter(Boolean)
        : [];
      const useMulti =
        !!multiAgent?.enabled &&
        providerList.length > 0 &&
        (providerList.length >= 2 || runsPerProvider > 1);
      let newWorkspace: Workspace;
      if (useMulti) {
        const providers = providerList.slice(0, multiAgent?.maxProviders || 4);
        const variants: Array<{
          id: string;
          provider: Provider;
          name: string;
          branch: string;
          path: string;
          worktreeId: string;
        }> = [];
        for (const provider of providers) {
          for (let instanceIdx = 1; instanceIdx <= runsPerProvider; instanceIdx++) {
            const instanceSuffix = runsPerProvider > 1 ? `-${instanceIdx}` : '';
            const variantName = `${workspaceName}-${provider.toLowerCase()}${instanceSuffix}`;
            const worktreeResult = await window.electronAPI.worktreeCreate({
              projectPath: selectedProject.path,
              workspaceName: variantName,
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
              id: `${workspaceName}-${provider.toLowerCase()}${instanceSuffix}`,
              provider: provider,
              name: variantName,
              branch: worktree.branch,
              path: worktree.path,
              worktreeId: worktree.id,
            });
          }
        }

        const multiMeta: WorkspaceMetadata = {
          ...(workspaceMetadata || {}),
          multiAgent: {
            enabled: true,
            maxProviders: multiAgent?.maxProviders || 4,
            runsPerProvider,
            providers,
            variants,
            selectedProvider: null,
          },
        };

        const groupId = `ws-${workspaceName}-${Date.now()}`;
        newWorkspace = {
          id: groupId,
          name: workspaceName,
          branch: variants[0]?.branch || selectedProject.gitInfo.branch || 'main',
          path: variants[0]?.path || selectedProject.path,
          status: 'idle',
          agentId: selectedProvider || undefined,
          metadata: multiMeta,
        } as Workspace;

        const saveResult = await window.electronAPI.saveWorkspace({
          ...newWorkspace,
          projectId: selectedProject.id,
          agentId: selectedProvider || undefined,
          metadata: multiMeta,
        });
        if (!saveResult?.success) {
          const { log } = await import('./lib/logger');
          log.error('Failed to save multi-agent workspace:', saveResult?.error);
          toast({ title: 'Error', description: 'Failed to create multi-agent workspace.' });
          setIsCreatingWorkspace(false);
          return;
        }
      } else {
        // Create worktree
        const worktreeResult = await window.electronAPI.worktreeCreate({
          projectPath: selectedProject.path,
          workspaceName,
          projectId: selectedProject.id,
          autoApprove,
        });

        if (!worktreeResult.success) {
          throw new Error(worktreeResult.error || 'Failed to create worktree');
        }

        const worktree = worktreeResult.worktree;

        newWorkspace = {
          id: worktree.id,
          name: workspaceName,
          branch: worktree.branch,
          path: worktree.path,
          status: 'idle',
          agentId: selectedProvider || undefined, // Save the selected provider as agentId
          metadata: workspaceMetadata,
        };

        const saveResult = await window.electronAPI.saveWorkspace({
          ...newWorkspace,
          projectId: selectedProject.id,
          agentId: selectedProvider || undefined,
          metadata: workspaceMetadata,
        });
        if (!saveResult?.success) {
          const { log } = await import('./lib/logger');
          log.error('Failed to save workspace:', saveResult?.error);
          toast({ title: 'Error', description: 'Failed to create workspace.' });
          setIsCreatingWorkspace(false);
          return;
        }
      }

      {
        if (workspaceMetadata?.linearIssue) {
          try {
            const convoResult = await window.electronAPI.getOrCreateDefaultConversation(
              newWorkspace.id
            );

            if (convoResult?.success && convoResult.conversation?.id) {
              const issue = workspaceMetadata.linearIssue;
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
                id: `linear-context-${newWorkspace.id}`,
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
            log.error('Failed to seed workspace with Linear issue context:', seedError as any);
          }
        }
        if (workspaceMetadata?.githubIssue) {
          try {
            const convoResult = await window.electronAPI.getOrCreateDefaultConversation(
              newWorkspace.id
            );

            if (convoResult?.success && convoResult.conversation?.id) {
              const issue = workspaceMetadata.githubIssue;
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
                id: `github-context-${newWorkspace.id}`,
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
            log.error('Failed to seed workspace with GitHub issue context:', seedError as any);
          }
        }
        if (workspaceMetadata?.jiraIssue) {
          try {
            const convoResult = await window.electronAPI.getOrCreateDefaultConversation(
              newWorkspace.id
            );

            if (convoResult?.success && convoResult.conversation?.id) {
              const issue: any = workspaceMetadata.jiraIssue;
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
                id: `jira-context-${newWorkspace.id}`,
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
            log.error('Failed to seed workspace with Jira issue context:', seedError as any);
          }
        }

        setProjects((prev) =>
          prev.map((project) =>
            project.id === selectedProject.id
              ? {
                  ...project,
                  workspaces: [...(project.workspaces || []), newWorkspace],
                }
              : project
          )
        );

        setSelectedProject((prev) =>
          prev
            ? {
                ...prev,
                workspaces: [...(prev.workspaces || []), newWorkspace],
              }
            : null
        );

        // Set the active workspace and its provider (none if multi-agent)
        setActiveWorkspace(newWorkspace);
        if ((newWorkspace.metadata as any)?.multiAgent?.enabled) {
          setActiveWorkspaceProvider(null);
        } else {
          // Use the saved agentId from the workspace, which should match selectedProvider
          setActiveWorkspaceProvider(
            (newWorkspace.agentId as Provider) || selectedProvider || 'codex'
          );
        }
      }
    } catch (error) {
      const { log } = await import('./lib/logger');
      log.error('Failed to create workspace:', error as any);
      toast({
        title: 'Error',
        description:
          (error as Error)?.message ||
          'Failed to create workspace. Please check the console for details.',
      });
    } finally {
      setIsCreatingWorkspace(false);
    }
  };

  const handleGoHome = () => {
    setSelectedProject(null);
    setShowHomeView(true);
    setActiveWorkspace(null);
  };

  const handleSelectProject = (project: Project) => {
    activateProjectView(project);
  };

  const handleSelectWorkspace = (workspace: Workspace) => {
    setActiveWorkspace(workspace);
    // Load provider from workspace.agentId if it exists, otherwise default to null
    // This ensures the selected provider persists across app restarts
    if ((workspace.metadata as any)?.multiAgent?.enabled) {
      setActiveWorkspaceProvider(null);
    } else {
      // Use agentId from workspace if available, otherwise fall back to 'codex' for backwards compatibility
      setActiveWorkspaceProvider((workspace.agentId as Provider) || 'codex');
    }
  };

  const handleStartCreateWorkspaceFromSidebar = useCallback(
    (project: Project) => {
      const targetProject = projects.find((p) => p.id === project.id) || project;
      activateProjectView(targetProject);
      setShowWorkspaceModal(true);
    },
    [activateProjectView, projects]
  );

  const removeWorkspaceFromState = (projectId: string, workspaceId: string, wasActive: boolean) => {
    const filterWorkspaces = (list?: Workspace[]) =>
      (list || []).filter((w) => w.id !== workspaceId);

    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? { ...project, workspaces: filterWorkspaces(project.workspaces) }
          : project
      )
    );

    setSelectedProject((prev) =>
      prev && prev.id === projectId
        ? { ...prev, workspaces: filterWorkspaces(prev.workspaces) }
        : prev
    );

    if (wasActive) {
      setActiveWorkspace(null);
      setActiveWorkspaceProvider(null);
    }
  };

  const handleDeleteWorkspace = async (
    targetProject: Project,
    workspace: Workspace,
    options?: { silent?: boolean }
  ): Promise<boolean> => {
    if (deletingWorkspaceIdsRef.current.has(workspace.id)) {
      toast({
        title: 'Deletion in progress',
        description: `"${workspace.name}" is already being removed.`,
      });
      return false;
    }

    const wasActive = activeWorkspace?.id === workspace.id;
    const workspaceSnapshot = { ...workspace };
    deletingWorkspaceIdsRef.current.add(workspace.id);
    removeWorkspaceFromState(targetProject.id, workspace.id, wasActive);

    const runDeletion = async (): Promise<boolean> => {
      try {
        try {
          // Clear initial prompt sent flags (legacy and per-provider) if present
          const { initialPromptSentKey } = await import('./lib/keys');
          try {
            // Legacy key (no provider)
            const legacy = initialPromptSentKey(workspace.id);
            localStorage.removeItem(legacy);
          } catch {}
          try {
            // Provider-scoped keys
            for (const p of TERMINAL_PROVIDER_IDS) {
              const k = initialPromptSentKey(workspace.id, p);
              localStorage.removeItem(k);
            }
          } catch {}
        } catch {}
        try {
          window.electronAPI.ptyKill?.(`workspace-${workspace.id}`);
        } catch {}
        try {
          for (const provider of TERMINAL_PROVIDER_IDS) {
            try {
              window.electronAPI.ptyKill?.(`${provider}-main-${workspace.id}`);
            } catch {}
          }
        } catch {}
        const sessionIds = [
          `workspace-${workspace.id}`,
          ...TERMINAL_PROVIDER_IDS.map((provider) => `${provider}-main-${workspace.id}`),
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
            worktreeId: workspace.id,
            worktreePath: workspace.path,
            branch: workspace.branch,
          }),
          window.electronAPI.deleteWorkspace(workspace.id),
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
              ? deleteResult.value?.error || 'Failed to delete workspace'
              : deleteResult.reason?.message || String(deleteResult.reason);
          throw new Error(errorMsg);
        }

        if (!options?.silent) {
          toast({
            title: 'Task deleted',
            description: workspace.name,
          });
        }
        return true;
      } catch (error) {
        const { log } = await import('./lib/logger');
        log.error('Failed to delete workspace:', error as any);
        toast({
          title: 'Error',
          description:
            error instanceof Error
              ? error.message
              : 'Could not delete workspace. Check the console for details.',
          variant: 'destructive',
        });

        try {
          const refreshedWorkspaces = await window.electronAPI.getWorkspaces(targetProject.id);
          setProjects((prev) =>
            prev.map((project) =>
              project.id === targetProject.id
                ? { ...project, workspaces: refreshedWorkspaces }
                : project
            )
          );
          setSelectedProject((prev) =>
            prev && prev.id === targetProject.id
              ? { ...prev, workspaces: refreshedWorkspaces }
              : prev
          );

          if (wasActive) {
            const restored = refreshedWorkspaces.find((w) => w.id === workspace.id);
            if (restored) {
              handleSelectWorkspace(restored);
            }
          }
        } catch (refreshError) {
          log.error('Failed to refresh workspaces after delete failure:', refreshError as any);

          setProjects((prev) =>
            prev.map((project) => {
              if (project.id !== targetProject.id) return project;
              const existing = project.workspaces || [];
              const alreadyPresent = existing.some((w) => w.id === workspaceSnapshot.id);
              return alreadyPresent
                ? project
                : { ...project, workspaces: [...existing, workspaceSnapshot] };
            })
          );
          setSelectedProject((prev) => {
            if (!prev || prev.id !== targetProject.id) return prev;
            const existing = prev.workspaces || [];
            const alreadyPresent = existing.some((w) => w.id === workspaceSnapshot.id);
            return alreadyPresent
              ? prev
              : { ...prev, workspaces: [...existing, workspaceSnapshot] };
          });

          if (wasActive) {
            handleSelectWorkspace(workspaceSnapshot);
          }
        }
        return false;
      } finally {
        deletingWorkspaceIdsRef.current.delete(workspace.id);
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

  const needsGhInstall = !ghInstalled;
  const needsGhAuth = ghInstalled && !isAuthenticated;

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

      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      if (selectedProject?.id === project.id) {
        setSelectedProject(null);
        setActiveWorkspace(null);
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

  const renderMainContent = () => {
    if (selectedProject && showKanban) {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <KanbanBoard
            project={selectedProject}
            onOpenWorkspace={(ws: any) => {
              handleSelectWorkspace(ws);
              setShowKanban(false);
            }}
            onCreateWorkspace={() => setShowWorkspaceModal(true)}
          />
        </div>
      );
    }
    if (showHomeView) {
      return (
        <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
          <div className="container mx-auto flex min-h-full flex-1 flex-col justify-center px-4 py-8">
            <div className="mb-6 text-center">
              <div className="mb-2 flex items-center justify-center">
                <div className="logo-shimmer-container">
                  <img
                    key={effectiveTheme}
                    src={effectiveTheme === 'dark' ? emdashLogoWhite : emdashLogo}
                    alt="emdash"
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
              <p className="text-sm text-muted-foreground sm:text-base">
                Run multiple Coding Agents in parallel
              </p>
              <RequirementsNotice
                showGithubRequirement={showGithubRequirement}
                needsGhInstall={needsGhInstall}
                needsGhAuth={needsGhAuth}
                showAgentRequirement={showAgentRequirement}
              />
            </div>

            <div className="flex flex-col justify-center gap-4 sm:flex-row">
              <Button onClick={handleOpenProject} size="lg" className="min-w-[200px]">
                <FolderOpen className="mr-2 h-5 w-5" />
                Open Project
              </Button>
            </div>
          </div>
        </div>
      );
    }

    if (selectedProject) {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {activeWorkspace ? (
            (activeWorkspace.metadata as any)?.multiAgent?.enabled ? (
              <MultiAgentWorkspace
                workspace={activeWorkspace}
                projectName={selectedProject.name}
                projectId={selectedProject.id}
              />
            ) : (
              <ChatInterface
                workspace={activeWorkspace}
                projectName={selectedProject.name}
                className="min-h-0 flex-1"
                initialProvider={activeWorkspaceProvider || undefined}
              />
            )
          ) : (
            <ProjectMainView
              project={selectedProject}
              onCreateWorkspace={() => setShowWorkspaceModal(true)}
              activeWorkspace={activeWorkspace}
              onSelectWorkspace={handleSelectWorkspace}
              onDeleteWorkspace={handleDeleteWorkspace}
              isCreatingWorkspace={isCreatingWorkspace}
              onDeleteProject={handleDeleteProject}
            />
          )}
        </div>
      );
    }

    return (
      <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
        <div className="container mx-auto flex min-h-full flex-1 flex-col justify-center px-4 py-8">
          <div className="mb-12 text-center">
            <div className="mb-4 flex items-center justify-center">
              <img
                key={effectiveTheme}
                src={effectiveTheme === 'dark' ? emdashLogoWhite : emdashLogo}
                alt="emdash"
                className="h-16"
              />
            </div>
            <p className="mb-6 text-sm text-muted-foreground sm:text-base">
              Run multiple Coding Agents in parallel
            </p>
            <RequirementsNotice
              showGithubRequirement={showGithubRequirement}
              needsGhInstall={needsGhInstall}
              needsGhAuth={needsGhAuth}
              showAgentRequirement={showAgentRequirement}
            />
          </div>

          <div className="mb-8 flex flex-col justify-center gap-4 sm:flex-row">
            <Button onClick={handleOpenProject} size="lg" className="min-w-[200px]">
              <FolderOpen className="mr-2 h-5 w-5" />
              Open Project
            </Button>
          </div>
        </div>
      </div>
    );
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
          <RightSidebarProvider defaultCollapsed>
            <AppKeyboardShortcuts
              showCommandPalette={showCommandPalette}
              showSettings={showSettings}
              handleToggleCommandPalette={handleToggleCommandPalette}
              handleOpenSettings={handleOpenSettings}
              handleCloseCommandPalette={handleCloseCommandPalette}
              handleCloseSettings={handleCloseSettings}
            />
            <RightSidebarBridge
              onCollapsedChange={handleRightSidebarCollapsedChange}
              setCollapsedRef={rightSidebarSetCollapsedRef}
            />
            <Titlebar
              onToggleSettings={handleToggleSettings}
              isSettingsOpen={showSettings}
              currentPath={
                activeWorkspace?.metadata?.multiAgent?.enabled
                  ? null
                  : activeWorkspace?.path || selectedProject?.path || null
              }
              defaultPreviewUrl={
                activeWorkspace?.id
                  ? getContainerRunState(activeWorkspace.id)?.previewUrl || null
                  : null
              }
              workspaceId={activeWorkspace?.id || null}
              workspacePath={activeWorkspace?.path || null}
              projectPath={selectedProject?.path || null}
              isWorkspaceMultiAgent={Boolean(activeWorkspace?.metadata?.multiAgent?.enabled)}
              githubUser={user}
              onToggleKanban={() => setShowKanban((v) => !v)}
              isKanbanOpen={Boolean(showKanban)}
              kanbanAvailable={Boolean(selectedProject)}
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
                    onSelectWorkspace={handleSelectWorkspace}
                    activeWorkspace={activeWorkspace || undefined}
                    onReorderProjects={handleReorderProjects}
                    onReorderProjectsFull={handleReorderProjectsFull}
                    githubInstalled={ghInstalled}
                    githubAuthenticated={isAuthenticated}
                    githubUser={user}
                    onSidebarContextChange={handleSidebarContextChange}
                    onCreateWorkspaceForProject={handleStartCreateWorkspaceFromSidebar}
                    isCreatingWorkspace={isCreatingWorkspace}
                    onDeleteWorkspace={handleDeleteWorkspace}
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
                  <RightSidebar workspace={activeWorkspace} className="lg:border-l-0" />
                </ResizablePanel>
              </ResizablePanelGroup>
            </div>
            <SettingsModal isOpen={showSettings} onClose={handleCloseSettings} />
            <CommandPaletteWrapper
              isOpen={showCommandPalette}
              onClose={handleCloseCommandPalette}
              projects={projects}
              handleSelectProject={handleSelectProject}
              handleSelectWorkspace={handleSelectWorkspace}
              handleGoHome={handleGoHome}
              handleOpenProject={handleOpenProject}
              handleOpenSettings={handleOpenSettings}
            />
            <WorkspaceModal
              isOpen={showWorkspaceModal}
              onClose={() => setShowWorkspaceModal(false)}
              onCreateWorkspace={handleCreateWorkspace}
              projectName={selectedProject?.name || ''}
              defaultBranch={selectedProject?.gitInfo.branch || 'main'}
              existingNames={(selectedProject?.workspaces || []).map((w) => w.name)}
              projectPath={selectedProject?.path}
            />
            <FirstLaunchModal open={showFirstLaunchModal} onClose={markFirstLaunchSeen} />
            <Toaster />
            <BrowserPane
              workspaceId={activeWorkspace?.id || null}
              workspacePath={activeWorkspace?.path || null}
              overlayActive={
                showSettings || showCommandPalette || showWorkspaceModal || showFirstLaunchModal
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
