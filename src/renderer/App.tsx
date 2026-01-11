import { motion } from 'framer-motion';
import React, { useEffect, useState } from 'react';
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
import CodeEditor from './components/FileExplorer/CodeEditor';
import SettingsModal from './components/SettingsModal';
import TaskModal from './components/TaskModal';
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
import { usePlanToasts } from './hooks/usePlanToasts';
import { useTheme } from './hooks/useTheme';
import useUpdateNotifier from './hooks/useUpdateNotifier';
import { getContainerRunState } from './lib/containerRuns';
import { BrowserProvider } from './providers/BrowserProvider';
import { terminalSessionRegistry } from './terminal/SessionRegistry';
import type { Project } from './types/app';
import { usePanelLayout, PANEL_CONSTANTS } from './hooks/usePanelLayout';
import { useProjectOperations } from './hooks/useProjectOperations';
import { useAppModals } from './hooks/useAppModals';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useGithubAuthFlow } from './hooks/useGithubAuthFlow';
import { HomeView } from './components/HomeView';

const RightSidebarBridge: React.FC<{
  onCollapsedChange: (collapsed: boolean) => void;
  setCollapsedRef: React.MutableRefObject<((next: boolean) => void) | null>;
}> = ({ onCollapsedChange, setCollapsedRef }) => {
  const { collapsed, setCollapsed } = useRightSidebar();

  React.useEffect(() => {
    onCollapsedChange(collapsed);
  }, [collapsed, onCollapsedChange]);

  React.useEffect(() => {
    setCollapsedRef.current = setCollapsed;
    return () => {
      setCollapsedRef.current = null;
    };
  }, [setCollapsed, setCollapsedRef]);

  return null;
};

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

const AppContent: React.FC = () => {
  usePlanToasts();
  const { effectiveTheme } = useTheme();
  const { toast } = useToast();

  // Electron API state
  const [, setVersion] = useState<string>('');
  const [platform, setPlatform] = useState<string>('');
  const {
    installed: ghInstalled,
    authenticated: isAuthenticated,
    user,
    isInitialized: isGithubInitialized,
  } = useGithubAuth();

  // Projects and navigation
  const [projects, setProjects] = useState<Project[]>([]);
  const {
    showHomeView,
    setShowHomeView,
    selectedProject,
    setSelectedProject,
    activeTask,
    setActiveTask,
    activeTaskProvider,
    setActiveTaskProvider,
    isCreatingTask,
    setIsCreatingTask,
    handleSelectTask,
    handleStartCreateTaskFromSidebar,
    handleCreateTask,
    handleNextTask,
    handlePrevTask,
    handleNewTask,
    markFirstLaunchSeen,
  } = useAppNavigation(projects, selectedProject, setSelectedProject, setShowHomeView, setProjects);

  // Modal states
  const {
    showEditorMode,
    setShowEditorMode,
    showTaskModal,
    setShowTaskModal,
    showNewProjectModal,
    setShowNewProjectModal,
    showCloneModal,
    setShowCloneModal,
    showSettings,
    setShowSettings,
    showCommandPalette,
    setShowCommandPalette,
    showFirstLaunchModal,
    setShowFirstLaunchModal,
    showDeviceFlowModal: showDeviceFlowModalState,
    setShowDeviceFlowModal: setShowDeviceFlowModalState,
    showKanban,
    setShowKanban,
    handleToggleSettings,
    handleOpenSettings,
    handleCloseSettings,
    handleToggleCommandPalette,
    handleCloseCommandPalette,
    handleToggleKanban,
  } = useAppModals();

  // Panel layout
  const panelLayout = usePanelLayout(showEditorMode);

  // Project operations
  const {
    handleOpenProject,
    handleNewProjectClick,
    handleCloneProjectClick,
    handleSelectProject,
    handleGoHome,
    handleDeleteTask,
    handleReorderProjects,
    handleReorderProjectsFull,
    handleDeleteProject,
    handleCloneSuccess,
    handleNewProjectSuccess,
    activateProjectView,
    applyProjectOrder,
  } = useProjectOperations(
    projects,
    setProjects,
    platform,
    isAuthenticated,
    ghInstalled,
    selectedProject,
    setSelectedProject,
    (proj) => {
      setSelectedProject(proj);
      setShowHomeView(false);
      setActiveTask(null);
    },
    setShowNewProjectModal,
    setShowCloneModal,
    setShowHomeView,
    setActiveTask
  );

  // GitHub auth flow
  const {
    showDeviceFlowModal,
    setShowDeviceFlowModal,
    handleGithubConnect,
    handleDeviceFlowSuccess,
    handleDeviceFlowError,
    handleDeviceFlowClose,
  } = useGithubAuthFlow(handleOpenSettings);

  // Show toast on update availability
  useUpdateNotifier({ checkOnMount: true, onOpenSettings: handleOpenSettings });

  // Initialize app on mount
  useEffect(() => {
    (async () => {
      try {
        const systemInfo = await window.electronAPI.getSystemInfo?.();
        if (systemInfo?.platform) {
          setPlatform(systemInfo.platform);
        }
      } catch {
        // Fallback to detecting platform
        setPlatform(
          process.platform === 'win32'
            ? 'win32'
            : process.platform === 'darwin'
              ? 'darwin'
              : 'linux'
        );
      }
    })();
  }, []);

  // Load projects
  useEffect(() => {
    (async () => {
      try {
        const res = await window.electronAPI.getProjects?.();
        if (res?.success && Array.isArray(res.projects)) {
          const ordered = applyProjectOrder(res.projects);
          setProjects(ordered);
        }
      } catch {
        // Ignore errors
      }
    })();
  }, [applyProjectOrder]);

  // Auto-collapse/expand right sidebar based on current view
  useEffect(() => {
    if (!panelLayout.autoRightSidebarBehavior) return;

    const isHomePage = showHomeView;
    const isRepoHomePage = selectedProject !== null && activeTask === null;
    const shouldCollapse = isHomePage || isRepoHomePage;
    const shouldExpand = activeTask !== null;

    if (shouldCollapse || shouldExpand) {
      const panelGroup = document.querySelector('[data-panel-group]');
      panelGroup?.classList.add('no-transition');

      if (shouldCollapse) {
        panelLayout.rightSidebarSetCollapsedRef.current?.(true);
      } else if (shouldExpand) {
        panelLayout.rightSidebarSetCollapsedRef.current?.(false);
      }

      requestAnimationFrame(() => {
        panelGroup?.classList.remove('no-transition');
      });
    }
  }, [panelLayout.autoRightSidebarBehavior, showHomeView, selectedProject, activeTask]);

  // Render main content based on state
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
        <HomeView
          effectiveTheme={effectiveTheme}
          onOpenProject={handleOpenProject}
          onCreateProject={handleNewProjectClick}
          onCloneProject={handleCloneProjectClick}
        />
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
        style={{ '--tb': PANEL_CONSTANTS.TITLEBAR_HEIGHT } as React.CSSProperties}
      >
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
                handleNextTask={handleNextTask}
                handlePrevTask={handlePrevTask}
                handleNewTask={handleNewTask}
              />
              <RightSidebarBridge
                onCollapsedChange={panelLayout.setRightSidebarCollapsed}
                setCollapsedRef={panelLayout.rightSidebarSetCollapsedRef}
              />
              <Titlebar
                onToggleSettings={handleToggleSettings}
                isSettingsOpen={showSettings}
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
                githubUser={user}
                onToggleKanban={handleToggleKanban}
                isKanbanOpen={Boolean(showKanban)}
                kanbanAvailable={Boolean(selectedProject)}
                onToggleEditor={() => setShowEditorMode(!showEditorMode)}
                showEditorButton={Boolean(activeTask)}
                isEditorOpen={showEditorMode}
              />
              <div className="flex flex-1 overflow-hidden pt-[var(--tb)]">
                <ResizablePanelGroup
                  direction="horizontal"
                  className="flex-1 overflow-hidden"
                  onLayout={panelLayout.handlePanelLayout}
                >
                  <ResizablePanel
                    ref={panelLayout.leftSidebarPanelRef}
                    className="sidebar-panel sidebar-panel--left"
                    defaultSize={panelLayout.defaultPanelLayout[0]}
                    minSize={PANEL_CONSTANTS.LEFT_SIDEBAR_MIN_SIZE}
                    maxSize={PANEL_CONSTANTS.LEFT_SIDEBAR_MAX_SIZE}
                    collapsedSize={0}
                    collapsible
                    order={1}
                    style={{ display: showEditorMode ? 'none' : undefined }}
                  >
                    <LeftSidebar
                      projects={projects}
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
                      onSidebarContextChange={panelLayout.handleSidebarContextChange}
                      onCreateTaskForProject={handleStartCreateTaskFromSidebar}
                      isCreatingTask={isCreatingTask}
                      onDeleteTask={handleDeleteTask}
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
                    defaultSize={panelLayout.defaultPanelLayout[1]}
                    minSize={PANEL_CONSTANTS.MAIN_PANEL_MIN_SIZE}
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
                    ref={panelLayout.rightSidebarPanelRef}
                    className="sidebar-panel sidebar-panel--right"
                    defaultSize={0}
                    minSize={PANEL_CONSTANTS.RIGHT_SIDEBAR_MIN_SIZE}
                    maxSize={PANEL_CONSTANTS.RIGHT_SIDEBAR_MAX_SIZE}
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
                onClose={() => {
                  setShowTaskModal(false);
                  setIsCreatingTask(false);
                }}
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
