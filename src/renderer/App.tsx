import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppKeyboardShortcuts from './components/AppKeyboardShortcuts';
import BrowserPane from './components/BrowserPane';
import { CloneFromUrlModal } from './components/CloneFromUrlModal';
import { AddRemoteProjectModal } from './components/ssh/AddRemoteProjectModal';
import CommandPaletteWrapper from './components/CommandPaletteWrapper';
import ErrorBoundary from './components/ErrorBoundary';
import { WelcomeScreen } from './components/WelcomeScreen';
import { GithubDeviceFlowModal } from './components/GithubDeviceFlowModal';
import LeftSidebar from './components/LeftSidebar';
import MainContentArea from './components/MainContentArea';
import { NewProjectModal } from './components/NewProjectModal';
import RightSidebar from './components/RightSidebar';
import CodeEditor from './components/FileExplorer/CodeEditor';
import SettingsModal from './components/SettingsModal';
import TaskModal from './components/TaskModal';
import { UpdateModal } from './components/UpdateModal';
import { ThemeProvider } from './components/ThemeProvider';
import Titlebar from './components/titlebar/Titlebar';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './components/ui/resizable';
import { RightSidebarProvider, useRightSidebar } from './components/ui/right-sidebar';
import { SidebarProvider } from './components/ui/sidebar';
import { KeyboardSettingsProvider } from './contexts/KeyboardSettingsContext';
import { ToastAction } from './components/ui/toast';
import { Toaster } from './components/ui/toaster';
import { useToast } from './hooks/use-toast';
import { useAutoPrRefresh } from './hooks/useAutoPrRefresh';
import { useTheme } from './hooks/useTheme';
import useUpdateNotifier from './hooks/useUpdateNotifier';
import { BrowserProvider } from './providers/BrowserProvider';
import type { LinearIssueSummary } from './types/linear';
import type { GitHubIssueSummary } from './types/github';
import type { JiraIssueSummary } from './types/jira';
import type { AgentRun } from './types/chat';
import type { Project } from './types/app';

// Extracted hooks
import { useModalState } from './hooks/useModalState';
import { usePanelLayout } from './hooks/usePanelLayout';
import { useAppInitialization } from './hooks/useAppInitialization';
import { useGithubIntegration } from './hooks/useGithubIntegration';
import { useProjectManagement } from './hooks/useProjectManagement';
import { useTaskManagement } from './hooks/useTaskManagement';
import { createTask } from './lib/taskCreationService';
import { getProjectRepoKey } from './lib/projectUtils';

// Extracted constants
import {
  TITLEBAR_HEIGHT,
  LEFT_SIDEBAR_MIN_SIZE,
  LEFT_SIDEBAR_MAX_SIZE,
  RIGHT_SIDEBAR_MIN_SIZE,
  RIGHT_SIDEBAR_MAX_SIZE,
  MAIN_PANEL_MIN_SIZE,
} from './constants/layout';

const PINNED_TASKS_KEY = 'emdash-pinned-tasks';

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
  useTheme(); // Initialize theme on app startup
  const { toast } = useToast();

  // Ref for selectedProject, so useModalState can read it without re-instantiation
  const selectedProjectRef = useRef<{ id: string } | null>(null);

  // --- Modal / UI visibility state ---
  const modals = useModalState({ selectedProjectRef });

  const {
    showSettings,
    settingsInitialTab,
    showCommandPalette,
    showWelcomeScreen,
    showTaskModal,
    showNewProjectModal,
    showCloneModal,
    showEditorMode,
    showKanban,
    showDeviceFlowModal,
    setShowEditorMode,
    setShowKanban,
    setShowTaskModal,
    setShowNewProjectModal,
    setShowCloneModal,
    openSettings,
    handleToggleSettings,
    handleOpenSettings,
    handleOpenKeyboardShortcuts,
    handleCloseSettings,
    handleToggleCommandPalette,
    handleCloseCommandPalette,
    handleToggleKanban,
    handleToggleEditor,
    handleWelcomeGetStarted,
  } = modals;
  const [showRemoteProjectModal, setShowRemoteProjectModal] = useState<boolean>(false);

  // Listen for native menu "Settings" click (main → renderer)
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuOpenSettings?.(() => {
      handleOpenSettings();
    });
    return () => cleanup?.();
  }, [handleOpenSettings]);

  // Listen for native menu "Check for Updates" click (main → renderer)
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  useEffect(() => {
    const cleanup = window.electronAPI.onMenuCheckForUpdates?.(() => {
      setShowUpdateModal(true);
    });
    return () => cleanup?.();
  }, []);

  // --- App initialization (version, platform, loadAppData) ---
  // The callbacks here execute inside a useEffect (after render), so all hooks
  // are already initialized by the time they run — no temporal dead zone issue.
  const appInit = useAppInitialization({
    checkGithubStatus: () => github.checkStatus(),
    onProjectsLoaded: (projects) => projectMgmt.setProjects(projects),
    onProjectSelected: (project) => projectMgmt.setSelectedProject(project),
    onShowHomeView: (show) => projectMgmt.setShowHomeView(show),
    onTaskSelected: (task) => taskMgmt.setActiveTask(task),
    onTaskAgentSelected: (agent) => taskMgmt.setActiveTaskAgent(agent),
    onInitialLoadComplete: () => {},
  });

  // --- GitHub integration ---
  const github = useGithubIntegration({
    platform: appInit.platform,
    toast,
    setShowDeviceFlowModal: modals.setShowDeviceFlowModal,
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
    setShowNewProjectModal,
    setShowCloneModal,
    setShowTaskModal,
    setActiveTask: (task) => taskMgmt.setActiveTask(task),
    saveProjectOrder: appInit.saveProjectOrder,
    ToastAction,
    storedActiveIds: appInit.storedActiveIds,
  });

  // Keep the selectedProject ref in sync for useModalState's kanban toggle guard
  // Using useEffect to avoid writing to ref during render (react-hooks/refs lint rule)
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
    setShowEditorMode,
    setShowKanban,
    setShowTaskModal,
    toast,
    activateProjectView: projectMgmt.activateProjectView,
  });

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
    isInitialLoadComplete: appInit.isInitialLoadComplete,
    showHomeView: projectMgmt.showHomeView,
    selectedProject: projectMgmt.selectedProject,
    activeTask: taskMgmt.activeTask,
  });

  // Show toast on update availability
  useUpdateNotifier({ checkOnMount: true, onOpenSettings: () => openSettings('general') });

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
      baseRef?: string
    ) => {
      if (!projectMgmt.selectedProject) return;
      await createTask(
        {
          taskName,
          initialPrompt,
          agentRuns,
          linkedLinearIssue,
          linkedGithubIssue,
          linkedJiraIssue,
          autoApprove,
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
        }
      );
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

  // --- SSH Remote Project handlers ---
  const handleAddRemoteProjectClick = useCallback(() => {
    setShowRemoteProjectModal(true);
  }, []);

  const handleRemoteProjectSuccess = useCallback(
    async (remoteProject: {
      id: string;
      name: string;
      path: string;
      host: string;
      connectionId: string;
    }) => {
      const { captureTelemetry } = await import('./lib/telemetryClient');
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

        const saveResult = await window.electronAPI.saveProject(project);
        if (saveResult.success) {
          captureTelemetry('project_create_success');
          captureTelemetry('project_added_success', { source: 'remote' });
          toast({
            title: 'Remote project added successfully!',
            description: `${project.name} on ${remoteProject.host} has been added to your projects.`,
          });
          // Add to beginning of list
          projectMgmt.setProjects((prev) => {
            const updated = [project, ...prev];
            appInit.saveProjectOrder(updated);
            return updated;
          });
          projectMgmt.activateProjectView(project);
        } else {
          toast({
            title: 'Failed to save remote project',
            description: saveResult.error || 'Unknown error occurred',
            variant: 'destructive',
          });
        }
      } catch (error) {
        const { log } = await import('./lib/logger');
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

  // --- Convenience aliases and SSH-derived remote connection info ---
  const { selectedProject } = projectMgmt;
  const { activeTask, activeTaskAgent } = taskMgmt;
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
                showCommandPalette={showCommandPalette}
                showSettings={showSettings}
                handleToggleCommandPalette={handleToggleCommandPalette}
                handleOpenSettings={handleOpenSettings}
                handleCloseCommandPalette={handleCloseCommandPalette}
                handleCloseSettings={handleCloseSettings}
                handleToggleKanban={handleToggleKanban}
                handleToggleEditor={handleToggleEditor}
                handleNextTask={taskMgmt.handleNextTask}
                handlePrevTask={taskMgmt.handlePrevTask}
                handleNewTask={taskMgmt.handleNewTask}
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
                      : activeTask?.path ||
                        (selectedProject?.isRemote
                          ? selectedProject?.remotePath
                          : selectedProject?.path) ||
                        null
                  }
                  defaultPreviewUrl={null}
                  taskId={activeTask?.id || null}
                  taskPath={activeTask?.path || null}
                  projectPath={selectedProject?.path || null}
                  isTaskMultiAgent={Boolean(activeTask?.metadata?.multiAgent?.enabled)}
                  githubUser={github.user}
                  onToggleKanban={handleToggleKanban}
                  isKanbanOpen={Boolean(showKanban)}
                  kanbanAvailable={Boolean(selectedProject)}
                  onToggleEditor={handleToggleEditor}
                  showEditorButton={Boolean(activeTask)}
                  isEditorOpen={showEditorMode}
                  projects={projectMgmt.projects}
                  selectedProject={selectedProject}
                  activeTask={activeTask}
                  onSelectProject={projectMgmt.handleSelectProject}
                  onSelectTask={taskMgmt.handleSelectTask}
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
                      projects={projectMgmt.projects}
                      archivedTasksVersion={taskMgmt.archivedTasksVersion}
                      selectedProject={selectedProject}
                      onSelectProject={projectMgmt.handleSelectProject}
                      onGoHome={projectMgmt.handleGoHome}
                      onOpenProject={projectMgmt.handleOpenProject}
                      onNewProject={projectMgmt.handleNewProjectClick}
                      onCloneProject={projectMgmt.handleCloneProjectClick}
                      onAddRemoteProject={handleAddRemoteProjectClick}
                      onSelectTask={taskMgmt.handleSelectTask}
                      activeTask={activeTask || undefined}
                      onReorderProjects={projectMgmt.handleReorderProjects}
                      onReorderProjectsFull={projectMgmt.handleReorderProjectsFull}
                      onSidebarContextChange={handleSidebarContextChange}
                      onCreateTaskForProject={taskMgmt.handleStartCreateTaskFromSidebar}
                      onDeleteTask={handleDeleteTaskAndUnpin}
                      onRenameTask={taskMgmt.handleRenameTask}
                      onArchiveTask={taskMgmt.handleArchiveTask}
                      onRestoreTask={taskMgmt.handleRestoreTask}
                      onDeleteProject={projectMgmt.handleDeleteProject}
                      pinnedTaskIds={pinnedTaskIds}
                      onPinTask={handlePinTask}
                      isHomeView={projectMgmt.showHomeView}
                      onGoToSkills={projectMgmt.handleGoToSkills}
                      isSkillsView={projectMgmt.showSkillsView}
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
                      <MainContentArea
                        selectedProject={selectedProject}
                        activeTask={activeTask}
                        activeTaskAgent={activeTaskAgent}
                        showKanban={showKanban}
                        showHomeView={projectMgmt.showHomeView}
                        showSkillsView={projectMgmt.showSkillsView}
                        projectDefaultBranch={projectMgmt.projectDefaultBranch}
                        projectBranchOptions={projectMgmt.projectBranchOptions}
                        isLoadingBranches={projectMgmt.isLoadingBranches}
                        setProjectDefaultBranch={projectMgmt.setProjectDefaultBranch}
                        handleSelectTask={taskMgmt.handleSelectTask}
                        handleDeleteTask={taskMgmt.handleDeleteTask}
                        handleArchiveTask={taskMgmt.handleArchiveTask}
                        handleDeleteProject={projectMgmt.handleDeleteProject}
                        handleOpenProject={projectMgmt.handleOpenProject}
                        handleNewProjectClick={projectMgmt.handleNewProjectClick}
                        handleCloneProjectClick={projectMgmt.handleCloneProjectClick}
                        handleAddRemoteProject={handleAddRemoteProjectClick}
                        setShowTaskModal={(show: boolean) => setShowTaskModal(show)}
                        setShowKanban={(show: boolean) => setShowKanban(show)}
                        projectRemoteConnectionId={derivedRemoteConnectionId}
                        projectRemotePath={derivedRemotePath}
                      />
                    </div>
                  </ResizablePanel>
                  <ResizableHandle
                    withHandle
                    className="hidden cursor-col-resize items-center justify-center transition-colors hover:bg-border/80 lg:flex"
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
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
              <SettingsModal
                isOpen={showSettings}
                onClose={handleCloseSettings}
                initialTab={settingsInitialTab}
              />
              <UpdateModal isOpen={showUpdateModal} onClose={() => setShowUpdateModal(false)} />
              <CommandPaletteWrapper
                isOpen={showCommandPalette}
                onClose={handleCloseCommandPalette}
                projects={projectMgmt.projects}
                handleSelectProject={projectMgmt.handleSelectProject}
                handleSelectTask={taskMgmt.handleSelectTask}
                handleGoHome={projectMgmt.handleGoHome}
                handleOpenProject={projectMgmt.handleOpenProject}
                handleOpenSettings={handleOpenSettings}
                handleOpenKeyboardShortcuts={handleOpenKeyboardShortcuts}
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
                defaultBranch={projectMgmt.projectDefaultBranch}
                existingNames={(selectedProject?.tasks || []).map((w) => w.name)}
                linkedGithubIssueMap={taskMgmt.linkedGithubIssueMap}
                projectPath={selectedProject?.path}
                branchOptions={projectMgmt.projectBranchOptions}
                isLoadingBranches={projectMgmt.isLoadingBranches}
              />
              <NewProjectModal
                isOpen={showNewProjectModal}
                onClose={() => setShowNewProjectModal(false)}
                onSuccess={projectMgmt.handleNewProjectSuccess}
              />
              <CloneFromUrlModal
                isOpen={showCloneModal}
                onClose={() => setShowCloneModal(false)}
                onSuccess={projectMgmt.handleCloneSuccess}
              />
              <AddRemoteProjectModal
                isOpen={showRemoteProjectModal}
                onClose={() => setShowRemoteProjectModal(false)}
                onSuccess={handleRemoteProjectSuccess}
              />
              {showWelcomeScreen && <WelcomeScreen onGetStarted={handleWelcomeGetStarted} />}
              <GithubDeviceFlowModal
                open={showDeviceFlowModal}
                onClose={github.handleDeviceFlowClose}
                onSuccess={github.handleDeviceFlowSuccess}
                onError={github.handleDeviceFlowError}
              />
              <Toaster />
              <BrowserPane
                taskId={activeTask?.id || null}
                taskPath={activeTask?.path || null}
                overlayActive={
                  showSettings || showCommandPalette || showTaskModal || showWelcomeScreen
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
