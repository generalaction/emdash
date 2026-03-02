import AppKeyboardShortcuts from '@/components/AppKeyboardShortcuts';
import BrowserPane from '@/components/BrowserPane';
import CommandPaletteWrapper from '@/components/CommandPaletteWrapper';
import { DiffViewer } from '@/components/diff-viewer';
import CodeEditor from '@/components/FileExplorer/CodeEditor';
import LeftSidebar from '@/components/LeftSidebar';
import MainContentArea from '@/components/MainContentArea';
import RightSidebar from '@/components/RightSidebar';
import Titlebar from '@/components/titlebar/Titlebar';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { RightSidebarProvider, useRightSidebar } from '@/components/ui/right-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toaster';
import { ModalProvider, useModalContext } from '@/contexts/ModalProvider';
import { ModalRenderer } from '@/components/ModalRenderer';
import {
  TITLEBAR_HEIGHT,
  LEFT_SIDEBAR_MIN_SIZE,
  LEFT_SIDEBAR_MAX_SIZE,
  MAIN_PANEL_MIN_SIZE,
  RIGHT_SIDEBAR_MIN_SIZE,
  RIGHT_SIDEBAR_MAX_SIZE,
} from '@/constants/layout';
import { KeyboardSettingsProvider } from '@/contexts/KeyboardSettingsContext';
import { ProjectManagementContext } from '@/contexts/ProjectManagementContext';
import { TaskManagementContext } from '@/contexts/TaskManagementContext';
import { useToast } from '@/hooks/use-toast';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { useAppInitialization } from '@/hooks/useAppInitialization';
import { useAutoPrRefresh } from '@/hooks/useAutoPrRefresh';
import { useGithubIntegration } from '@/hooks/useGithubIntegration';
import { usePanelLayout } from '@/hooks/usePanelLayout';
import { useProjectManagement } from '@/hooks/useProjectManagement';
import { useTaskManagement } from '@/hooks/useTaskManagement';
import { useTheme } from '@/hooks/useTheme';
import useUpdateNotifier from '@/hooks/useUpdateNotifier';
import { activityStore } from '@/lib/activityStore';
import { handleMenuUndo, handleMenuRedo } from '@/lib/menuUndoRedo';
import { getProjectRepoKey } from '@/lib/projectUtils';
import { rpc } from '@/lib/rpc';
import { soundPlayer } from '@/lib/soundPlayer';
import { createTask } from '@/lib/taskCreationService';
import BrowserProvider from '@/providers/BrowserProvider';
import { Project } from '@/types/app';
import { AgentRun } from '@/types/chat';
import { GitHubIssueSummary } from '@/types/github';
import { JiraIssueSummary } from '@/types/jira';
import { LinearIssueSummary } from '@/types/linear';
import { ToastAction } from '@radix-ui/react-toast';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { log } from '@/lib/logger';

const PINNED_TASKS_KEY = 'emdash-pinned-tasks';
const PANEL_RESIZE_DRAGGING_EVENT = 'emdash:panel-resize-dragging';
type ResizeHandleId = 'left' | 'right';

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

export function Workspace() {
  return (
    <ModalProvider>
      <WorkspaceInner />
    </ModalProvider>
  );
}

function WorkspaceInner() {
  useTheme(); // Initialize theme on app startup
  const { toast } = useToast();
  const { showModal } = useModalContext();
  const [isCreatingTask, setIsCreatingTask] = useState<boolean>(false);

  // Agent event hook: plays sounds and updates sidebar status for all tasks
  const handleAgentEvent = useCallback((event: import('@shared/agentEvents').AgentEvent) => {
    activityStore.handleAgentEvent(event);
  }, []);
  useAgentEvents(handleAgentEvent);

  // Load notification sound settings
  useEffect(() => {
    (async () => {
      try {
        const settings = await rpc.appSettings.get();
        const notif = settings.notifications;
        const masterEnabled = Boolean(notif?.enabled ?? true);
        const soundOn = Boolean(notif?.sound ?? true);
        soundPlayer.setEnabled(masterEnabled && soundOn);
        soundPlayer.setFocusMode(notif?.soundFocusMode ?? 'always');
      } catch {}
    })();
  }, []);

  const selectedProjectRef = useRef<{ id: string } | null>(null);

  // --- View-mode / UI visibility state (inlined from former useModalState) ---
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [settingsPageInitialTab, setSettingsPageInitialTab] = useState<
    'general' | 'clis-models' | 'integrations' | 'repository' | 'interface' | 'docs'
  >('general');
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showEditorMode, setShowEditorMode] = useState(false);
  const [showKanban, setShowKanban] = useState(false);

  const openSettingsPage = useCallback(
    (
      tab:
        | 'general'
        | 'clis-models'
        | 'integrations'
        | 'repository'
        | 'interface'
        | 'docs' = 'general'
    ) => {
      setSettingsPageInitialTab(tab);
      setShowSettingsPage(true);
    },
    []
  );
  const handleCloseSettingsPage = useCallback(() => setShowSettingsPage(false), []);
  const handleToggleCommandPalette = useCallback(() => setShowCommandPalette((prev) => !prev), []);
  const handleCloseCommandPalette = useCallback(() => setShowCommandPalette(false), []);
  const handleToggleKanban = useCallback(() => {
    if (!selectedProjectRef.current) return;
    setShowEditorMode(false);
    setShowKanban((v) => !v);
  }, []);
  const handleToggleEditor = useCallback(() => {
    setShowKanban(false);
    setShowEditorMode((v) => !v);
  }, []);
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [diffViewerInitialFile, setDiffViewerInitialFile] = useState<string | null>(null);
  const [diffViewerTaskPath, setDiffViewerTaskPath] = useState<string | null>(null);
  const panelHandleDraggingRef = useRef<Record<ResizeHandleId, boolean>>({
    left: false,
    right: false,
  });

  const handlePanelResizeDragging = useCallback((handleId: ResizeHandleId, dragging: boolean) => {
    if (panelHandleDraggingRef.current[handleId] === dragging) return;
    const wasDragging = panelHandleDraggingRef.current.left || panelHandleDraggingRef.current.right;
    panelHandleDraggingRef.current[handleId] = dragging;
    const isDragging = panelHandleDraggingRef.current.left || panelHandleDraggingRef.current.right;
    if (wasDragging === isDragging) return;
    window.dispatchEvent(
      new CustomEvent(PANEL_RESIZE_DRAGGING_EVENT, {
        detail: { dragging: isDragging },
      })
    );
  }, []);

  useEffect(() => {
    return () => {
      const wasDragging =
        panelHandleDraggingRef.current.left || panelHandleDraggingRef.current.right;
      panelHandleDraggingRef.current.left = false;
      panelHandleDraggingRef.current.right = false;
      if (!wasDragging) return;
      window.dispatchEvent(
        new CustomEvent(PANEL_RESIZE_DRAGGING_EVENT, {
          detail: { dragging: false },
        })
      );
    };
  }, []);

  // Listen for native menu "Settings" click (main → renderer)
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuOpenSettings?.(() => {
      openSettingsPage();
    });
    return () => cleanup?.();
  }, [openSettingsPage]);

  // Listen for native menu Undo/Redo (main → renderer) and keep operations editor-scoped.
  useEffect(() => {
    const cleanupUndo = window.electronAPI.onMenuUndo?.(() => {
      handleMenuUndo();
    });
    const cleanupRedo = window.electronAPI.onMenuRedo?.(() => {
      handleMenuRedo();
    });
    return () => {
      cleanupUndo?.();
      cleanupRedo?.();
    };
  }, []);

  // Listen for native menu "Close Tab" (Cmd+W) — dispatches to active ChatInterface
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuCloseTab?.(() => {
      window.dispatchEvent(new CustomEvent('emdash:close-active-chat'));
    });
    return () => cleanup?.();
  }, []);

  // --- App initialization (version, platform, loadAppData) ---
  // The callbacks here execute inside a useEffect (after render), so all hooks
  // are already initialized by the time they run — no temporal dead zone issue.
  const appInit = useAppInitialization({
    checkGithubStatus: () => github.checkStatus(),
    onProjectsLoaded: (projects) => projectMgmt.setProjects(projects),
    onShowHomeView: (show) => projectMgmt.setShowHomeView(show),
    onInitialLoadComplete: () => {},
  });

  // Stable ref for openTaskModal to break the projectMgmt/taskMgmt circular init
  // (both hooks need it, but the implementation needs data from both hooks)
  const openTaskModalRef = useRef<() => void>(() => {});
  const stableOpenTaskModal = useCallback(() => openTaskModalRef.current(), []);

  // --- GitHub integration ---
  const github = useGithubIntegration({
    platform: appInit.platform,
    toast,
  });

  // --- Project management ---
  const projectMgmt = useProjectManagement({
    platform: appInit.platform,
    isAuthenticated: github.isAuthenticated,
    ghInstalled: github.ghInstalled,
    toast,
    handleGithubConnect: github.handleGithubConnect,
    setShowEditorMode,
    setShowKanban,
    openTaskModal: stableOpenTaskModal,
    setActiveTask: (task) => taskMgmt.setActiveTask(task),
    saveProjectOrder: appInit.saveProjectOrder,
    ToastAction,
  });

  // Keep selectedProject ref in sync for the kanban toggle guard
  useEffect(() => {
    selectedProjectRef.current = projectMgmt.selectedProject;
  }, [projectMgmt.selectedProject]);

  // --- Task management ---
  const taskMgmt = useTaskManagement({
    projects: projectMgmt.projects,
    selectedProject: projectMgmt.selectedProject,
    setProjects: projectMgmt.setProjects,
    setSelectedProject: projectMgmt.setSelectedProject,
    setShowHomeView: projectMgmt.setShowHomeView,
    setShowSkillsView: projectMgmt.setShowSkillsView,
    setShowEditorMode,
    setShowKanban,
    openTaskModal: stableOpenTaskModal,
    toast,
    activateProjectView: projectMgmt.activateProjectView,
  });

  // Focus task when OS notification is clicked
  const notificationFocusRef = useRef({
    allTasks: taskMgmt.allTasks,
    selectedProject: projectMgmt.selectedProject,
    handleSelectTask: taskMgmt.handleSelectTask,
  });
  useEffect(() => {
    notificationFocusRef.current = {
      allTasks: taskMgmt.allTasks,
      selectedProject: projectMgmt.selectedProject,
      handleSelectTask: taskMgmt.handleSelectTask,
    };
  });

  useEffect(() => {
    const cleanup = window.electronAPI.onNotificationFocusTask((taskId: string) => {
      const { allTasks, selectedProject, handleSelectTask } = notificationFocusRef.current;
      const entry = allTasks.find((t) => t.task.id === taskId);
      if (!entry) return;
      const { task, project } = entry;
      if (!selectedProject || selectedProject.id !== project.id) {
        projectMgmt.activateProjectView(project);
      }
      setShowKanban(false);
      setShowEditorMode(false);
      handleCloseSettingsPage();
      handleSelectTask(task);
    });
    return cleanup;
  }, [projectMgmt.activateProjectView, handleCloseSettingsPage]);

  // --- Panel layout ---
  const {
    defaultPanelLayout,
    leftSidebarPanelRef,
    rightSidebarPanelRef,
    rightSidebarSetCollapsedRef,
    handlePanelLayout,
    handleSidebarContextChange,
    handleRightSidebarCollapsedChange,
  } = usePanelLayout({
    showEditorMode,
    showDiffViewer,
    isInitialLoadComplete: appInit.isInitialLoadComplete,
    showHomeView: projectMgmt.showHomeView,
    selectedProject: projectMgmt.selectedProject,
    activeTask: taskMgmt.activeTask,
  });

  // Show toast on update availability
  useUpdateNotifier({ checkOnMount: true, onOpenSettings: () => openSettingsPage('general') });

  // Listen for native menu "Check for Updates" click (main → renderer)
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuCheckForUpdates?.(() => {
      showModal('updateModal', {});
    });
    return () => cleanup?.();
  }, [showModal]);

  // Auto-refresh PR status
  useAutoPrRefresh(taskMgmt.activeTask?.path);

  // --- Pinned tasks (localStorage) ---
  const [pinnedTaskIds, setPinnedTaskIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(PINNED_TASKS_KEY);
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });

  const handlePinTask = useCallback((task: { id: string }) => {
    setPinnedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(task.id)) {
        next.delete(task.id);
      } else {
        next.add(task.id);
      }
      localStorage.setItem(PINNED_TASKS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const { handleDeleteTask } = taskMgmt;
  const handleDeleteTaskAndUnpin: typeof handleDeleteTask = useCallback(
    async (project, task, options) => {
      setPinnedTaskIds((prev) => {
        if (!prev.has(task.id)) return prev;
        const next = new Set(prev);
        next.delete(task.id);
        localStorage.setItem(PINNED_TASKS_KEY, JSON.stringify([...next]));
        return next;
      });
      return handleDeleteTask(project, task, options);
    },
    [handleDeleteTask]
  );

  // --- Task creation wrapper ---
  const handleCreateTask = useCallback(
    async (
      taskName: string,
      initialPrompt?: string,
      agentRuns: AgentRun[] = [{ agent: 'claude', runs: 1 }],
      linkedLinearIssue: LinearIssueSummary | null = null,
      linkedGithubIssue: GitHubIssueSummary | null = null,
      linkedJiraIssue: JiraIssueSummary | null = null,
      autoApprove?: boolean,
      useWorktree: boolean = true,
      baseRef?: string,
      nameGenerated?: boolean
    ) => {
      if (!projectMgmt.selectedProject) return;
      setIsCreatingTask(true);
      const started = await createTask(
        {
          taskName,
          initialPrompt,
          agentRuns,
          linkedLinearIssue,
          linkedGithubIssue,
          linkedJiraIssue,
          autoApprove,
          nameGenerated,
          useWorktree,
          baseRef,
        },
        {
          selectedProject: projectMgmt.selectedProject,
          setProjects: projectMgmt.setProjects,
          setSelectedProject: projectMgmt.setSelectedProject,
          setActiveTask: taskMgmt.setActiveTask,
          setActiveTaskAgent: taskMgmt.setActiveTaskAgent,
          toast,
          onTaskCreationFailed: () => setIsCreatingTask(false),
        }
      );
      if (!started) {
        setIsCreatingTask(false);
      }
    },
    [
      projectMgmt.selectedProject,
      projectMgmt.setProjects,
      projectMgmt.setSelectedProject,
      taskMgmt.setActiveTask,
      taskMgmt.setActiveTaskAgent,
      toast,
    ]
  );

  useEffect(() => {
    if (!isCreatingTask) return;
    const timeout = window.setTimeout(() => {
      setIsCreatingTask(false);
    }, 30000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [isCreatingTask]);

  const handleTaskInterfaceReady = useCallback(() => {
    setIsCreatingTask(false);
  }, []);

  // Wire up the stable openTaskModal ref with current project/task data
  openTaskModalRef.current = () => {
    showModal('taskModal', {
      onSuccess: ({
        name,
        initialPrompt,
        agentRuns,
        linkedLinearIssue,
        linkedGithubIssue,
        linkedJiraIssue,
        autoApprove,
        useWorktree,
        baseRef,
        nameGenerated,
      }) =>
        handleCreateTask(
          name,
          initialPrompt,
          agentRuns,
          linkedLinearIssue,
          linkedGithubIssue,
          linkedJiraIssue,
          autoApprove,
          useWorktree,
          baseRef,
          nameGenerated
        ),
    });
  };

  // --- SSH Remote Project handlers ---
  const handleRemoteProjectSuccess = useCallback(
    async (remoteProject: {
      id: string;
      name: string;
      path: string;
      host: string;
      connectionId: string;
    }) => {
      const { captureTelemetry } = await import('../lib/telemetryClient');
      captureTelemetry('remote_project_created');

      try {
        // Check for existing project with same repoKey
        const repoKey = `${remoteProject.host}:${remoteProject.path}`;
        const existingProject = projectMgmt.projects.find((p) => getProjectRepoKey(p) === repoKey);

        if (existingProject) {
          projectMgmt.activateProjectView(existingProject);
          toast({
            title: 'Project already open',
            description: `"${existingProject.name}" is already in the sidebar.`,
          });
          return;
        }

        // Create project object for remote project
        const project: Project = {
          id: remoteProject.id,
          name: remoteProject.name,
          path: remoteProject.path,
          repoKey,
          gitInfo: {
            isGitRepo: true,
          },
          tasks: [],
          // Mark as remote project
          isRemote: true,
          sshConnectionId: remoteProject.connectionId,
          remotePath: remoteProject.path,
        } as Project;

        await rpc.db.saveProject(project);
        captureTelemetry('project_create_success');
        captureTelemetry('project_added_success', { source: 'remote' });
        toast({
          title: 'Remote project added successfully!',
          description: `${project.name} on ${remoteProject.host} has been added to your projects.`,
        });
        projectMgmt.setProjects((prev) => {
          const updated = [project, ...prev];
          appInit.saveProjectOrder(updated);
          return updated;
        });
        projectMgmt.activateProjectView(project);
      } catch (error) {
        log.error('Failed to save remote project:', error);
        toast({
          title: 'Failed to add remote project',
          description: 'An error occurred while saving the project.',
          variant: 'destructive',
        });
      }
    },
    [projectMgmt.projects, projectMgmt.activateProjectView, toast, appInit.saveProjectOrder]
  );

  const handleAddRemoteProjectClick = useCallback(() => {
    showModal('addRemoteProjectModal', { onSuccess: handleRemoteProjectSuccess });
  }, [showModal, handleRemoteProjectSuccess]);

  // --- Convenience aliases and SSH-derived remote connection info ---
  const { selectedProject } = projectMgmt;
  const { activeTask } = taskMgmt;
  const activeTaskProjectPath = activeTask?.projectId
    ? projectMgmt.projects.find((p) => p.id === activeTask.projectId)?.path || null
    : null;

  const derivedRemoteConnectionId = useMemo((): string | null => {
    if (!selectedProject) return null;
    if (selectedProject.sshConnectionId) return selectedProject.sshConnectionId;
    const alias = selectedProject.name;
    if (typeof alias !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(alias)) return null;

    // Back-compat for remote projects created before remote fields were persisted.
    // Heuristic: on macOS/Windows, a /home/... project path is almost certainly remote.
    const p = selectedProject.path || '';
    const looksRemoteByPath =
      appInit.platform === 'darwin'
        ? p.startsWith('/home/')
        : appInit.platform === 'win32'
          ? p.startsWith('/home/')
          : false;

    if (selectedProject.isRemote || looksRemoteByPath) {
      return `ssh-config:${encodeURIComponent(alias)}`;
    }
    return null;
  }, [selectedProject, appInit.platform]);

  const derivedRemotePath = useMemo((): string | null => {
    if (!selectedProject) return null;
    if (selectedProject.remotePath) return selectedProject.remotePath;
    // If we derived a connection id, treat project.path as the remote path.
    if (derivedRemoteConnectionId) return selectedProject.path;
    return selectedProject.isRemote ? selectedProject.path : null;
  }, [selectedProject, derivedRemoteConnectionId]);

  // Close modals before titlebar view toggles
  const handleTitlebarKanbanToggle = useCallback(() => {
    const isModalOpen = showCommandPalette || showSettingsPage;
    if (isModalOpen) {
      if (showCommandPalette) handleCloseCommandPalette();
      if (showSettingsPage) handleCloseSettingsPage();
      setTimeout(() => handleToggleKanban(), 100);
    } else {
      handleToggleKanban();
    }
  }, [
    showCommandPalette,
    showSettingsPage,
    handleCloseCommandPalette,
    handleCloseSettingsPage,
    handleToggleKanban,
  ]);

  const handleTitlebarEditorToggle = useCallback(() => {
    const isModalOpen = showCommandPalette || showSettingsPage;
    if (isModalOpen) {
      if (showCommandPalette) handleCloseCommandPalette();
      if (showSettingsPage) handleCloseSettingsPage();
      setTimeout(() => handleToggleEditor(), 100);
    } else {
      handleToggleEditor();
    }
  }, [
    showCommandPalette,
    showSettingsPage,
    handleCloseCommandPalette,
    handleCloseSettingsPage,
    handleToggleEditor,
  ]);

  const handleOpenInEditor = useCallback(() => {
    window.dispatchEvent(new CustomEvent('emdash:open-in-editor'));
  }, []);

  const handleToggleSettingsPage = useCallback(() => {
    if (showSettingsPage) {
      handleCloseSettingsPage();
      return;
    }
    openSettingsPage();
  }, [showSettingsPage, handleCloseSettingsPage, openSettingsPage]);

  return (
    <ProjectManagementContext.Provider value={projectMgmt}>
      <TaskManagementContext.Provider value={taskMgmt}>
        <BrowserProvider>
          <div
            className="flex h-[100dvh] w-full flex-col bg-background text-foreground"
            style={{ '--tb': TITLEBAR_HEIGHT } as React.CSSProperties}
          >
            <KeyboardSettingsProvider>
              <SidebarProvider>
                <RightSidebarProvider>
                  <AppKeyboardShortcuts
                    showCommandPalette={showCommandPalette}
                    showSettings={showSettingsPage}
                    handleToggleCommandPalette={handleToggleCommandPalette}
                    handleOpenSettings={handleToggleSettingsPage}
                    handleCloseCommandPalette={handleCloseCommandPalette}
                    handleCloseSettings={handleCloseSettingsPage}
                    handleToggleKanban={handleToggleKanban}
                    handleToggleEditor={handleToggleEditor}
                    handleOpenInEditor={handleOpenInEditor}
                  />
                  <RightSidebarBridge
                    onCollapsedChange={handleRightSidebarCollapsedChange}
                    setCollapsedRef={rightSidebarSetCollapsedRef}
                  />
                  <Titlebar
                    onToggleSettings={handleToggleSettingsPage}
                    isSettingsOpen={showSettingsPage}
                    githubUser={github.user}
                    defaultPreviewUrl={null}
                    onToggleKanban={handleTitlebarKanbanToggle}
                    isKanbanOpen={Boolean(showKanban)}
                    onToggleEditor={handleTitlebarEditorToggle}
                    isEditorOpen={showEditorMode}
                  />
                  <div className="relative flex flex-1 overflow-hidden pt-[var(--tb)]">
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
                          onAddRemoteProject={handleAddRemoteProjectClick}
                          onSidebarContextChange={handleSidebarContextChange}
                          onDeleteTask={handleDeleteTaskAndUnpin}
                          pinnedTaskIds={pinnedTaskIds}
                          onPinTask={handlePinTask}
                          onCloseSettingsPage={handleCloseSettingsPage}
                        />
                      </ResizablePanel>
                      <ResizableHandle
                        withHandle
                        onDragging={(dragging) => handlePanelResizeDragging('left', dragging)}
                        className="hidden cursor-col-resize items-center justify-center transition-colors hover:bg-border/80 lg:flex"
                      />
                      <ResizablePanel
                        className="sidebar-panel sidebar-panel--main"
                        defaultSize={defaultPanelLayout[1]}
                        minSize={MAIN_PANEL_MIN_SIZE}
                        order={2}
                      >
                        <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
                          {showDiffViewer ? (
                            <DiffViewer
                              onClose={() => {
                                setShowDiffViewer(false);
                                setDiffViewerInitialFile(null);
                                setDiffViewerTaskPath(null);
                              }}
                              taskId={activeTask?.id}
                              taskPath={diffViewerTaskPath || activeTask?.path}
                              initialFile={diffViewerInitialFile}
                            />
                          ) : (
                            <MainContentArea
                              isCreatingTask={isCreatingTask}
                              onTaskInterfaceReady={handleTaskInterfaceReady}
                              showKanban={showKanban}
                              showSettingsPage={showSettingsPage}
                              settingsPageInitialTab={settingsPageInitialTab}
                              handleCloseSettingsPage={handleCloseSettingsPage}
                              handleAddRemoteProject={handleAddRemoteProjectClick}
                              openTaskModal={stableOpenTaskModal}
                              setShowKanban={(show: boolean) => setShowKanban(show)}
                              projectRemoteConnectionId={derivedRemoteConnectionId}
                              projectRemotePath={derivedRemotePath}
                            />
                          )}
                        </div>
                      </ResizablePanel>
                      <ResizableHandle
                        withHandle
                        onDragging={(dragging) => handlePanelResizeDragging('right', dragging)}
                        className="hidden cursor-col-resize items-center justify-center transition-colors hover:bg-border/80 sm:flex"
                      />
                      <ResizablePanel
                        ref={rightSidebarPanelRef}
                        className="sidebar-panel sidebar-panel--right"
                        defaultSize={defaultPanelLayout[2]}
                        minSize={RIGHT_SIDEBAR_MIN_SIZE}
                        maxSize={RIGHT_SIDEBAR_MAX_SIZE}
                        collapsedSize={0}
                        collapsible
                        order={3}
                      >
                        <RightSidebar
                          task={activeTask}
                          projectPath={selectedProject?.path || activeTaskProjectPath}
                          projectRemoteConnectionId={derivedRemoteConnectionId}
                          projectRemotePath={derivedRemotePath}
                          projectDefaultBranch={projectMgmt.projectDefaultBranch}
                          className="lg:border-l-0"
                          forceBorder={showEditorMode}
                          onOpenChanges={(filePath?: string, taskPath?: string) => {
                            setDiffViewerInitialFile(filePath ?? null);
                            setDiffViewerTaskPath(taskPath ?? null);
                            setShowDiffViewer(true);
                          }}
                        />
                      </ResizablePanel>
                    </ResizablePanelGroup>
                  </div>
                  <CommandPaletteWrapper
                    isOpen={showCommandPalette}
                    onClose={handleCloseCommandPalette}
                    handleGoHome={() => {
                      handleCloseSettingsPage();
                      projectMgmt.handleGoHome();
                    }}
                    handleOpenSettings={() => openSettingsPage()}
                    handleOpenKeyboardShortcuts={() => openSettingsPage('interface')}
                  />
                  {showEditorMode && activeTask && selectedProject && (
                    <CodeEditor
                      taskPath={activeTask.path}
                      taskName={activeTask.name}
                      projectName={selectedProject.name}
                      onClose={() => setShowEditorMode(false)}
                      connectionId={derivedRemoteConnectionId}
                      remotePath={derivedRemotePath}
                    />
                  )}

                  <ModalRenderer />
                  <Toaster />
                  <BrowserPane
                    taskId={activeTask?.id || null}
                    taskPath={activeTask?.path || null}
                    overlayActive={showSettingsPage || showCommandPalette}
                  />
                </RightSidebarProvider>
              </SidebarProvider>
            </KeyboardSettingsProvider>
          </div>
        </BrowserProvider>
      </TaskManagementContext.Provider>
    </ProjectManagementContext.Provider>
  );
}
