import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Provider } from './types';
import type { Project, Task } from './types/app';
import type { LinearIssueSummary } from './types/linear';
import type { GitHubIssueSummary } from './types/github';
import type { JiraIssueSummary } from './types/jira';

// Components
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './components/ThemeProvider';
import Titlebar from './components/titlebar/Titlebar';
import LeftSidebar from './components/LeftSidebar';
import RightSidebar from './components/RightSidebar';
import { MainContentArea } from './components/MainContentArea';
import BrowserPane from './components/BrowserPane';
import CodeEditor from './components/FileExplorer/CodeEditor';
import { WelcomeScreen } from './components/WelcomeScreen';
import FirstLaunchModal from './components/FirstLaunchModal';
import { GithubDeviceFlowModal } from './components/GithubDeviceFlowModal';
import TaskModal from './components/TaskModal';
import { NewProjectModal } from './components/NewProjectModal';
import { CloneFromUrlModal } from './components/CloneFromUrlModal';
import SettingsModal from './components/SettingsModal';
import CommandPaletteWrapper from './components/CommandPaletteWrapper';
import AppKeyboardShortcuts from './components/AppKeyboardShortcuts';

// UI Components
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/resizable';
import { SidebarProvider } from './components/ui/sidebar';
import { RightSidebarProvider, useRightSidebar } from './components/ui/right-sidebar';
import { Toaster } from './components/ui/toaster';
import { ToastAction } from './components/ui/toast';

// Providers & Contexts
import { KeyboardSettingsProvider } from './contexts/KeyboardSettingsContext';
import { BrowserProvider } from './providers/BrowserProvider';

// Hooks
import { useToast } from './hooks/use-toast';
import { useTheme } from './hooks/useTheme';
import { useGithubAuth } from './hooks/useGithubAuth';
import { useUpdateNotifier } from './hooks/useUpdateNotifier';
import { useModalState } from './hooks/useModalState';
import { usePanelLayout } from './hooks/usePanelLayout';
import { useProjectManagement } from './hooks/useProjectManagement';
import { useTaskManagement } from './hooks/useTaskManagement';
import { useGithubIntegration } from './hooks/useGithubIntegration';
import { useAppInitialization } from './hooks/useAppInitialization';

// Services & Utils
import { createTask, prepareTaskPrompt } from './lib/taskCreationService';
import { handleCloneSuccess, handleNewProjectSuccess } from './lib/projectService';
import { PROJECT_ORDER_KEY, TITLEBAR_HEIGHT, LEFT_SIDEBAR_MIN_SIZE, LEFT_SIDEBAR_MAX_SIZE, RIGHT_SIDEBAR_MIN_SIZE, RIGHT_SIDEBAR_MAX_SIZE, MAIN_PANEL_MIN_SIZE } from './constants/layout';

// Bridge component for right sidebar state
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

const AppContent: React.FC = () => {
  const { toast } = useToast();
  const { effectiveTheme } = useTheme();
  const { authenticated: isAuthenticated, user } = useGithubAuth();

  // Initialize app
  const appInit = useAppInitialization();

  // Modal state management
  const modalState = useModalState();

  // Initialize task management state first (without dependencies)
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [activeTaskProvider, setActiveTaskProvider] = useState<Provider | null>(null);

  // Project management (can now use setActiveTask and setActiveTaskProvider)
  const projectManagement = useProjectManagement({
    isAuthenticated,
    setActiveTask,
    setActiveTaskProvider,
  });

  // Task management (now has access to projectManagement)
  const taskManagement = useTaskManagement({
    projects: projectManagement.projects,
    selectedProject: projectManagement.selectedProject,
    activateProjectView: projectManagement.activateProjectView,
    setProjects: projectManagement.setProjects,
    setSelectedProject: projectManagement.setSelectedProject,
  });

  // Override taskManagement state with our local state
  taskManagement.activeTask = activeTask;
  taskManagement.activeTaskProvider = activeTaskProvider;
  taskManagement.setActiveTask = setActiveTask;
  taskManagement.setActiveTaskProvider = setActiveTaskProvider;

  // Panel layout management
  const panelLayout = usePanelLayout({
    showEditorMode: modalState.showEditorMode,
    showHomeView: projectManagement.showHomeView,
    selectedProject: projectManagement.selectedProject,
    activeTask: taskManagement.activeTask,
  });

  // GitHub integration
  const github = useGithubIntegration();

  // Update notifier
  useUpdateNotifier({
    checkOnMount: true,
    onOpenSettings: modalState.openSettings
  });

  // Load initial projects
  useEffect(() => {
    if (appInit.isInitialized && appInit.platform) {
      appInit.loadProjects().then(projects => {
        projectManagement.setProjects(projects);
      });
    }
    // Note: Intentionally omitting appInit.loadProjects and projectManagement.setProjects
    // to avoid infinite loops as they may not be stable references
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appInit.isInitialized, appInit.platform]);

  // Save project order helper
  const saveProjectOrder = useCallback((list: Project[]) => {
    try {
      const ids = list.map((p) => p.id);
      localStorage.setItem(PROJECT_ORDER_KEY, JSON.stringify(ids));
    } catch {}
  }, []);

  // Handle new task creation
  const handleCreateTask = useCallback(async (
    taskName: string,
    initialPrompt?: string,
    providerRuns: import('./types/chat').ProviderRun[] = [{ provider: 'claude', runs: 1 }],
    linkedLinearIssue: LinearIssueSummary | null = null,
    linkedGithubIssue: GitHubIssueSummary | null = null,
    linkedJiraIssue: JiraIssueSummary | null = null,
    autoApprove?: boolean,
    useWorktree: boolean = true,
    baseRef?: string
  ) => {
    if (!projectManagement.selectedProject) return;

    taskManagement.setIsCreatingTask(true);
    try {
      const result = await createTask({
        selectedProject: projectManagement.selectedProject,
        taskName,
        initialPrompt,
        providerRuns,
        linkedLinearIssue,
        linkedGithubIssue,
        linkedJiraIssue,
        autoApprove,
        useWorktree,
        baseRef,
      });

      // Update project with new task
      projectManagement.setProjects((prev) =>
        prev.map((project) =>
          project.id === projectManagement.selectedProject!.id
            ? { ...project, tasks: [result.task, ...(project.tasks || [])] }
            : project
        )
      );

      projectManagement.setSelectedProject((prev) =>
        prev ? { ...prev, tasks: [result.task, ...(prev.tasks || [])] } : null
      );

      // Set active task
      taskManagement.setActiveTask(result.task);
      if ((result.task.metadata as any)?.multiAgent?.enabled) {
        taskManagement.setActiveTaskProvider(null);
      } else {
        taskManagement.setActiveTaskProvider((result.task.agentId as Provider) || 'codex');
      }
    } catch (error) {
      const { log } = await import('./lib/logger');
      log.error('Failed to create task:', error as any);
      toast({
        title: 'Error',
        description: (error as Error)?.message || 'Failed to create task',
        variant: 'destructive',
      });
    } finally {
      taskManagement.setIsCreatingTask(false);
    }
  }, [projectManagement, taskManagement, toast]);

  // Handle opening new project modal
  const handleNewProjectClick = useCallback(async () => {
    const { captureTelemetry } = await import('./lib/telemetryClient');
    captureTelemetry('project_create_clicked');

    if (!isAuthenticated || github.needsGhInstall) {
      toast({
        title: 'GitHub authentication required',
        variant: 'destructive',
        action: (
          <ToastAction altText="Connect GitHub" onClick={github.handleGithubConnect}>
            Connect GitHub
          </ToastAction>
        ),
      });
      return;
    }

    modalState.openNewProjectModal();
  }, [isAuthenticated, github, modalState, toast]);

  // Handle opening clone modal
  const handleCloneProjectClick = useCallback(async () => {
    const { captureTelemetry } = await import('./lib/telemetryClient');
    captureTelemetry('project_clone_clicked');

    if (!isAuthenticated || github.needsGhInstall) {
      toast({
        title: 'GitHub authentication required',
        variant: 'destructive',
        action: (
          <ToastAction altText="Connect GitHub" onClick={github.handleGithubConnect}>
            Connect GitHub
          </ToastAction>
        ),
      });
      return;
    }

    modalState.openCloneModal();
  }, [isAuthenticated, github, modalState, toast]);

  // Handle clone success
  const onCloneSuccess = useCallback(async (projectPath: string) => {
    const result = await handleCloneSuccess(
      projectPath,
      appInit.platform,
      isAuthenticated,
      projectManagement.projects
    );

    if (result.success && result.project) {
      projectManagement.setProjects(prev => [...prev, result.project!]);
      projectManagement.activateProjectView(result.project);
    } else if (result.error) {
      toast({
        title: 'Clone Failed',
        description: result.error,
        variant: 'destructive',
      });
    }
  }, [appInit.platform, isAuthenticated, projectManagement, toast]);

  // Handle new project success
  const onNewProjectSuccess = useCallback(async (projectPath: string) => {
    const result = await handleNewProjectSuccess(
      projectPath,
      appInit.platform,
      isAuthenticated,
      projectManagement.projects,
      saveProjectOrder
    );

    if (result.success && result.project) {
      projectManagement.setProjects(prev => [result.project!, ...prev]);
      projectManagement.activateProjectView(result.project);
      modalState.openTaskModal();

      toast({
        title: 'Project created successfully!',
        description: `${result.project.name} has been added to your projects.`,
      });
    } else if (result.error) {
      toast({
        title: 'Project Creation Failed',
        description: result.error,
        variant: 'destructive',
      });
    }
  }, [appInit.platform, isAuthenticated, projectManagement, modalState, saveProjectOrder, toast]);

  // Handle starting task creation from sidebar
  const handleStartCreateTaskFromSidebar = useCallback((project: Project) => {
    const targetProject = projectManagement.projects.find(p => p.id === project.id) || project;
    projectManagement.activateProjectView(targetProject);
    modalState.openTaskModal();
  }, [projectManagement, modalState]);

  // Handle new task keyboard shortcut
  const handleNewTask = useCallback(() => {
    if (projectManagement.selectedProject) {
      modalState.openTaskModal();
    }
  }, [projectManagement.selectedProject, modalState]);

  // All tasks for cycling
  const allTasks = useMemo(() => {
    const tasks: { task: Task; project: Project }[] = [];
    for (const project of projectManagement.projects) {
      for (const task of project.tasks || []) {
        tasks.push({ task, project });
      }
    }
    return tasks;
  }, [projectManagement.projects]);

  return (
    <BrowserProvider>
      <div
        className="flex h-[100dvh] w-full flex-col bg-background text-foreground"
        style={{ '--tb': TITLEBAR_HEIGHT } as React.CSSProperties}
      >
        <KeyboardSettingsProvider>
          <SidebarProvider>
            <RightSidebarProvider>
              <AppKeyboardShortcuts
                showCommandPalette={modalState.showCommandPalette}
                showSettings={modalState.showSettings}
                handleToggleCommandPalette={modalState.toggleCommandPalette}
                handleOpenSettings={modalState.openSettings}
                handleCloseCommandPalette={modalState.closeCommandPalette}
                handleCloseSettings={modalState.closeSettings}
                handleToggleKanban={() => projectManagement.selectedProject && modalState.toggleKanban()}
                handleToggleEditor={modalState.toggleEditorMode}
                handleNextTask={taskManagement.handleNextTask}
                handlePrevTask={taskManagement.handlePrevTask}
                handleNewTask={handleNewTask}
              />

              <RightSidebarBridge
                onCollapsedChange={panelLayout.handleRightSidebarCollapsedChange}
                setCollapsedRef={panelLayout.rightSidebarSetCollapsedRef}
              />

              {!appInit.showWelcomeScreen && (
                <Titlebar
                  onToggleSettings={modalState.toggleSettings}
                  isSettingsOpen={modalState.showSettings}
                  currentPath={
                    taskManagement.activeTask?.metadata?.multiAgent?.enabled
                      ? null
                      : taskManagement.activeTask?.path || projectManagement.selectedProject?.path || null
                  }
                  defaultPreviewUrl={null}
                  taskId={taskManagement.activeTask?.id || null}
                  taskPath={taskManagement.activeTask?.path || null}
                  projectPath={projectManagement.selectedProject?.path || null}
                  isTaskMultiAgent={Boolean(taskManagement.activeTask?.metadata?.multiAgent?.enabled)}
                  githubUser={user}
                  onToggleKanban={() => projectManagement.selectedProject && modalState.toggleKanban()}
                  isKanbanOpen={modalState.showKanban}
                  kanbanAvailable={Boolean(projectManagement.selectedProject)}
                  onToggleEditor={modalState.toggleEditorMode}
                  showEditorButton={Boolean(taskManagement.activeTask)}
                  isEditorOpen={modalState.showEditorMode}
                />
              )}

              <div className={`flex flex-1 overflow-hidden ${!appInit.showWelcomeScreen ? 'pt-[var(--tb)]' : ''}`}>
                <ResizablePanelGroup
                  direction="horizontal"
                  className="flex-1 overflow-hidden"
                  onLayout={panelLayout.handlePanelLayout}
                >
                  <ResizablePanel
                    ref={panelLayout.leftSidebarPanelRef}
                    className="sidebar-panel sidebar-panel--left"
                    defaultSize={panelLayout.defaultPanelLayout[0]}
                    minSize={LEFT_SIDEBAR_MIN_SIZE}
                    maxSize={LEFT_SIDEBAR_MAX_SIZE}
                    collapsedSize={0}
                    collapsible
                    order={1}
                    style={{ display: modalState.showEditorMode ? 'none' : undefined }}
                  >
                    <LeftSidebar
                      projects={projectManagement.projects}
                      selectedProject={projectManagement.selectedProject}
                      onSelectProject={projectManagement.handleSelectProject}
                      onGoHome={projectManagement.handleGoHome}
                      onOpenProject={projectManagement.handleOpenProject}
                      onNewProject={handleNewProjectClick}
                      onCloneProject={handleCloneProjectClick}
                      onSelectTask={taskManagement.handleSelectTask}
                      activeTask={taskManagement.activeTask || undefined}
                      onReorderProjects={projectManagement.handleReorderProjects}
                      onReorderProjectsFull={projectManagement.handleReorderProjectsFull}
                      onSidebarContextChange={panelLayout.handleSidebarContextChange}
                      onCreateTaskForProject={handleStartCreateTaskFromSidebar}
                      isCreatingTask={taskManagement.isCreatingTask}
                      onDeleteTask={taskManagement.handleDeleteTask}
                      onRenameTask={taskManagement.handleRenameTask}
                      onDeleteProject={projectManagement.handleDeleteProject}
                      isHomeView={projectManagement.showHomeView}
                    />
                  </ResizablePanel>

                  <ResizableHandle
                    withHandle
                    className="hidden cursor-col-resize items-center justify-center transition-colors hover:bg-border/80 lg:flex"
                  />

                  <ResizablePanel
                    className="sidebar-panel sidebar-panel--main"
                    defaultSize={panelLayout.defaultPanelLayout[1]}
                    minSize={MAIN_PANEL_MIN_SIZE}
                    order={2}
                  >
                    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
                      <MainContentArea
                        showHomeView={projectManagement.showHomeView}
                        showKanban={modalState.showKanban}
                        selectedProject={projectManagement.selectedProject}
                        activeTask={taskManagement.activeTask}
                        activeTaskProvider={taskManagement.activeTaskProvider}
                        projectBranchOptions={projectManagement.projectBranchOptions}
                        isLoadingBranches={projectManagement.isLoadingBranches}
                        projectDefaultBranch={projectManagement.projectDefaultBranch}
                        isCreatingTask={taskManagement.isCreatingTask}
                        onOpenProject={projectManagement.handleOpenProject}
                        onNewProject={handleNewProjectClick}
                        onCloneProject={handleCloneProjectClick}
                        onCreateTask={modalState.openTaskModal}
                        onSelectTask={taskManagement.handleSelectTask}
                        onDeleteTask={taskManagement.handleDeleteTask}
                        onDeleteProject={projectManagement.handleDeleteProject}
                        onBaseBranchChange={projectManagement.setProjectDefaultBranch}
                        onCloseKanban={() => modalState.setKanbanOpen(false)}
                      />
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
                    minSize={RIGHT_SIDEBAR_MIN_SIZE}
                    maxSize={RIGHT_SIDEBAR_MAX_SIZE}
                    collapsedSize={0}
                    collapsible
                    order={3}
                  >
                    <RightSidebar
                      task={taskManagement.activeTask}
                      projectPath={projectManagement.selectedProject?.path || null}
                      className="lg:border-l-0"
                      forceBorder={modalState.showEditorMode}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>

              {/* Modals */}
              <SettingsModal
                isOpen={modalState.showSettings}
                onClose={modalState.closeSettings}
              />

              <CommandPaletteWrapper
                isOpen={modalState.showCommandPalette}
                onClose={modalState.closeCommandPalette}
                projects={projectManagement.projects}
                handleSelectProject={projectManagement.handleSelectProject}
                handleSelectTask={taskManagement.handleSelectTask}
                handleGoHome={projectManagement.handleGoHome}
                handleOpenProject={projectManagement.handleOpenProject}
                handleOpenSettings={modalState.openSettings}
              />

              {modalState.showEditorMode && taskManagement.activeTask && projectManagement.selectedProject && (
                <CodeEditor
                  taskPath={taskManagement.activeTask.path}
                  taskName={taskManagement.activeTask.name}
                  projectName={projectManagement.selectedProject.name}
                  onClose={() => modalState.setEditorMode(false)}
                />
              )}

              <TaskModal
                isOpen={modalState.showTaskModal}
                onClose={modalState.closeTaskModal}
                onCreateTask={handleCreateTask}
                projectName={projectManagement.selectedProject?.name || ''}
                defaultBranch={projectManagement.projectDefaultBranch}
                existingNames={(projectManagement.selectedProject?.tasks || []).map((w) => w.name)}
                projectPath={projectManagement.selectedProject?.path}
                branchOptions={projectManagement.projectBranchOptions}
                isLoadingBranches={projectManagement.isLoadingBranches}
              />

              <NewProjectModal
                isOpen={modalState.showNewProjectModal}
                onClose={modalState.closeNewProjectModal}
                onSuccess={onNewProjectSuccess}
              />

              <CloneFromUrlModal
                isOpen={modalState.showCloneModal}
                onClose={modalState.closeCloneModal}
                onSuccess={onCloneSuccess}
              />

              {appInit.showWelcomeScreen && (
                <WelcomeScreen onGetStarted={appInit.handleWelcomeGetStarted} />
              )}

              <FirstLaunchModal
                open={appInit.showFirstLaunchModal}
                onClose={appInit.markFirstLaunchSeen}
              />

              <GithubDeviceFlowModal
                open={github.showDeviceFlowModal}
                onClose={github.handleDeviceFlowClose}
                onSuccess={github.handleDeviceFlowSuccess}
                onError={github.handleDeviceFlowError}
              />

              <Toaster />

              <BrowserPane
                taskId={taskManagement.activeTask?.id || null}
                taskPath={taskManagement.activeTask?.path || null}
                overlayActive={
                  modalState.showSettings ||
                  modalState.showCommandPalette ||
                  modalState.showTaskModal ||
                  appInit.showWelcomeScreen ||
                  appInit.showFirstLaunchModal
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