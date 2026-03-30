import AppKeyboardShortcuts from '@/components/AppKeyboardShortcuts';
import BrowserPane from '@/components/BrowserPane';
import CommandPaletteWrapper from '@/components/CommandPaletteWrapper';
import { DiffViewer } from '@/components/diff-viewer';
import { TaskScopeProvider } from '@/components/TaskScopeContext';
import CodeEditor from '@/components/FileExplorer/CodeEditor';
import { LeftSidebar } from '@/components/sidebar/LeftSidebar';
import MainContentArea from '@/components/MainContentArea';
import RightSidebar from '@/components/RightSidebar';
import Titlebar from '@/components/titlebar/Titlebar';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { RightSidebarProvider, useRightSidebar } from '@/components/ui/right-sidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/toaster';
import { useModalContext } from '@/contexts/ModalProvider';
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
import { useTaskManagementContext } from '@/contexts/TaskManagementContext';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import { useAgentEvents } from '@/hooks/useAgentEvents';
import { useAutoPrRefresh } from '@/hooks/useAutoPrRefresh';
import { useFeatureFlag } from '@/hooks/useFeatureFlag';
import { usePanelLayout } from '@/hooks/usePanelLayout';
import { useProjectRemoteInfo } from '@/hooks/useProjectRemoteInfo';
import { useProjectManagementContext } from '@/contexts/ProjectManagementProvider';
import { useTheme } from '@/hooks/useTheme';
import useUpdateNotifier from '@/hooks/useUpdateNotifier';
import { useAutomationTrigger } from '@/hooks/useAutomationTrigger';
import { useMcpTaskTrigger } from '@/hooks/useMcpTaskTrigger';
import { activityStore } from '@/lib/activityStore';
import { agentStatusStore } from '@/lib/agentStatusStore';
import { handleMenuUndo, handleMenuRedo } from '@/lib/menuUndoRedo';
import { soundPlayer } from '@/lib/soundPlayer';
import BrowserProvider, { useBrowser } from '@/providers/BrowserProvider';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { SettingsPageTab } from '@/components/SettingsPage';
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

/** Bridge that reads BrowserProvider context and forwards it to AppKeyboardShortcuts */
const BrowserAwareShortcuts: React.FC<
  Omit<React.ComponentProps<typeof AppKeyboardShortcuts>, 'showBrowser' | 'handleCloseBrowser'>
> = (props) => {
  const browser = useBrowser();
  return (
    <AppKeyboardShortcuts
      {...props}
      showBrowser={browser.isOpen}
      handleCloseBrowser={browser.close}
    />
  );
};

export function Workspace() {
  const automationsEnabled = useFeatureFlag('automations');
  useTheme(); // Initialize theme on app startup
  const { showModal } = useModalContext();
  const { settings } = useAppSettings();

  // Agent event hook: plays sounds and updates sidebar status for all tasks
  const handleAgentEvent = useCallback((event: import('@shared/agentEvents').AgentEvent) => {
    activityStore.handleAgentEvent(event);
    agentStatusStore.handleAgentEvent(event);
  }, []);
  useAgentEvents(handleAgentEvent);

  useEffect(() => {
    const notif = settings?.notifications;
    const masterEnabled = Boolean(notif?.enabled ?? true);
    const soundOn = Boolean(notif?.sound ?? true);
    soundPlayer.setEnabled(masterEnabled && soundOn);
    soundPlayer.setFocusMode(notif?.soundFocusMode ?? 'always');
    soundPlayer.setProfile(notif?.soundProfile ?? 'default');
  }, [settings?.notifications]);

  // --- View-mode / UI visibility state (inlined from former useModalState) ---
  const [showSettingsPage, setShowSettingsPage] = useState(false);
  const [settingsPageInitialTab, setSettingsPageInitialTab] = useState<SettingsPageTab>('general');
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  const openSettingsPage = useCallback((tab: SettingsPageTab = 'general') => {
    setSettingsPageInitialTab(tab);
    setShowSettingsPage(true);
  }, []);

  const handleCloseSettingsPage = useCallback(() => setShowSettingsPage(false), []);
  const handleToggleCommandPalette = useCallback(() => setShowCommandPalette((prev) => !prev), []);
  const handleCloseCommandPalette = useCallback(() => setShowCommandPalette(false), []);
  const [showDiffViewer, setShowDiffViewer] = useState(false);
  const [diffViewerInitialFile, setDiffViewerInitialFile] = useState<string | null>(null);
  const [diffViewerTaskPath, setDiffViewerTaskPath] = useState<string | null>(null);
  const handleCloseDiffViewer = useCallback(() => {
    setShowDiffViewer(false);
    setDiffViewerInitialFile(null);
    setDiffViewerTaskPath(null);
  }, []);
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

  // --- Project management (provided by ProjectManagementProvider in App.tsx) ---
  const projectMgmt = useProjectManagementContext();
  const { showEditorMode, setShowEditorMode, setShowKanban } = projectMgmt;

  // Listen for native menu "Settings" click (main → renderer)
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuOpenSettings?.(() => {
      openSettingsPage();
    });
    return () => cleanup?.();
  }, [openSettingsPage]);

  const handleToggleKanban = useCallback(() => {
    if (!projectMgmt.selectedProject) return;
    setShowEditorMode(false);
    setShowKanban((v) => !v);
  }, [projectMgmt.selectedProject, setShowEditorMode, setShowKanban]);
  const handleToggleEditor = useCallback(() => {
    setShowKanban(false);
    setShowEditorMode((v) => !v);
  }, [setShowKanban, setShowEditorMode]);
  const handleCloseEditor = useCallback(() => setShowEditorMode(false), [setShowEditorMode]);
  const handleCloseKanban = useCallback(() => setShowKanban(false), [setShowKanban]);

  // --- Task management ---
  const taskMgmt = useTaskManagementContext();

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
    isInitialLoadComplete: projectMgmt.isInitialLoadComplete,
    showHomeView: projectMgmt.showHomeView,
    showSettingsPage,
    showSkillsView: projectMgmt.showSkillsView,
    showMcpView: projectMgmt.showMcpView,
    showAutomationsView: projectMgmt.showAutomationsView,
    selectedProject: projectMgmt.selectedProject,
    activeTask: taskMgmt.activeTask,
  });

  // Show toast on update availability
  useUpdateNotifier({
    checkOnMount: true,
    onOpenSettings: () => openSettingsPage('general'),
  });

  // Listen for native menu "Check for Updates" click (main → renderer)
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuCheckForUpdates?.(() => {
      showModal('updateModal', {});
    });
    return () => cleanup?.();
  }, [showModal]);

  // Auto-refresh PR status
  useAutoPrRefresh(taskMgmt.activeTask?.path);

  // Listen for automation triggers from the main process (scheduled + manual)
  useAutomationTrigger(automationsEnabled);

  // Listen for MCP task requests from the local MCP server
  useMcpTaskTrigger();

  // --- Convenience aliases and SSH-derived remote connection info ---
  const { selectedProject } = projectMgmt;
  const { activeTask, isCreatingTask } = taskMgmt;

  // Hide the sidebar while the task is being created OR while it's still the
  // optimistic placeholder (id starts with "optimistic-"). The latter guards
  // against handleTaskInterfaceReady clearing isCreatingTask too early (it fires
  // when ChatInterface first mounts with the placeholder, before onSuccess).
  const isOptimisticTask = activeTask?.id?.startsWith('optimistic-') ?? false;
  const effectiveTask = isCreatingTask || isOptimisticTask ? null : activeTask;
  const activeTaskProjectPath = useMemo(
    () =>
      activeTask?.projectId
        ? projectMgmt.projects.find((p) => p.id === activeTask.projectId)?.path || null
        : null,
    [activeTask, projectMgmt.projects]
  );

  const { connectionId: derivedRemoteConnectionId, remotePath: derivedRemotePath } =
    useProjectRemoteInfo();

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
    <BrowserProvider>
      <div
        className="flex h-[100dvh] w-full flex-col bg-background text-foreground"
        style={{ '--tb': TITLEBAR_HEIGHT } as React.CSSProperties}
      >
        <KeyboardSettingsProvider>
          <SidebarProvider>
            <RightSidebarProvider>
              <BrowserAwareShortcuts
                showCommandPalette={showCommandPalette}
                showSettings={showSettingsPage}
                showDiffViewer={showDiffViewer}
                showEditor={showEditorMode && !!activeTask && !!selectedProject}
                showKanban={!!projectMgmt.showKanban && !!selectedProject}
                handleToggleCommandPalette={handleToggleCommandPalette}
                handleOpenSettings={handleToggleSettingsPage}
                handleCloseCommandPalette={handleCloseCommandPalette}
                handleCloseSettings={handleCloseSettingsPage}
                handleCloseDiffViewer={handleCloseDiffViewer}
                handleCloseEditor={handleCloseEditor}
                handleCloseKanban={handleCloseKanban}
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
                onToggleKanban={handleTitlebarKanbanToggle}
                onToggleEditor={handleTitlebarEditorToggle}
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
                      onSidebarContextChange={handleSidebarContextChange}
                      onCloseSettingsPage={handleCloseSettingsPage}
                      onOpenAccountSettings={() => openSettingsPage('account')}
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
                        <TaskScopeProvider
                          value={{
                            taskId: activeTask?.id,
                            taskPath: diffViewerTaskPath || activeTask?.path,
                            projectPath: selectedProject?.path || activeTaskProjectPath,
                            prNumber: activeTask?.metadata?.prNumber ?? undefined,
                          }}
                        >
                          <DiffViewer
                            onClose={handleCloseDiffViewer}
                            taskId={activeTask?.id}
                            taskPath={diffViewerTaskPath || activeTask?.path}
                            initialFile={diffViewerInitialFile}
                          />
                        </TaskScopeProvider>
                      ) : (
                        <MainContentArea
                          showSettingsPage={showSettingsPage}
                          settingsPageInitialTab={settingsPageInitialTab}
                          handleCloseSettingsPage={handleCloseSettingsPage}
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
                      task={effectiveTask}
                      projectPath={selectedProject?.path || activeTaskProjectPath}
                      projectRemoteConnectionId={derivedRemoteConnectionId}
                      projectRemotePath={derivedRemotePath}
                      projectDefaultBranch={projectMgmt.projectDefaultBranch}
                      className="lg:border-l-0"
                      forceBorder={showEditorMode}
                      onOpenChanges={(filePath?: string, taskPath?: string) => {
                        setShowEditorMode(false);
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
                  taskId={activeTask.id}
                  taskPath={activeTask.path}
                  taskName={activeTask.name}
                  projectName={selectedProject.name}
                  onClose={handleCloseEditor}
                  connectionId={derivedRemoteConnectionId}
                  remotePath={derivedRemotePath}
                  showSettingsPage={showSettingsPage}
                  settingsPageInitialTab={settingsPageInitialTab}
                  onCloseSettingsPage={handleCloseSettingsPage}
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
  );
}
