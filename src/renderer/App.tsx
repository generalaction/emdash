import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PendingProjectsProvider } from './components/add-project-modal/pending-projects-provider';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './components/ThemeProvider';
import { RightSidebarProvider } from './components/ui/right-sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import { AgentProvider } from './contexts/AgentProvider';
import { AppContextProvider } from './contexts/AppContextProvider';
import { AppSettingsProvider } from './contexts/AppSettingsProvider';
import { DependenciesProvider } from './contexts/DependenciesProvider';
import { GithubContextProvider } from './contexts/GithubContextProvider';
import { IntegrationsProvider } from './contexts/IntegrationsProvider';
import { SshConnectionProvider } from './contexts/SshConnectionProvider';
import { ModalProvider } from './core/modal/modal-provider';
import { ProjectsProvider } from './core/projects/project-provider';
import { TerminalPoolProvider } from './core/pty/pty-pool-provider';
import { WorkspaceLayoutContextProvider } from './core/view/layout-provider';
import { WorkspaceViewProvider } from './core/view/provider';
import { ConversationDataProvider } from './features/conversations/conversation-data-provider';
import { ConversationSessionsProvider } from './features/conversations/conversation-sessions-provider';
import { TaskViewStateProvider } from './features/tasks/task-view-state-provider';
import { TasksProvider } from './features/tasks/tasks-provider';
import { useLocalStorage } from './hooks/useLocalStorage';
import BrowserProvider from './providers/BrowserProvider';
import { PendingTasksProvider } from './views/projects/pending-tasks-provider';
import { WelcomeScreen } from './views/Welcome';
import { Workspace } from './views/Workspace';

export const FIRST_LAUNCH_KEY = 'emdash:first-launch:v1';

const queryClient = new QueryClient();

export function App() {
  const [isFirstLaunch, setIsFirstLaunch] = useLocalStorage<boolean>(FIRST_LAUNCH_KEY, true);

  const renderContent = () => {
    if (isFirstLaunch) {
      return <WelcomeScreen onGetStarted={() => setIsFirstLaunch(false)} />;
    }
    return <Workspace />;
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DependenciesProvider>
          <ModalProvider>
            <WorkspaceLayoutContextProvider>
              <AppContextProvider>
                <AppSettingsProvider>
                  <TerminalPoolProvider>
                    <ConversationSessionsProvider>
                      <SshConnectionProvider>
                        <GithubContextProvider>
                          <IntegrationsProvider>
                            <WorkspaceViewProvider>
                              <ProjectsProvider>
                                <PendingProjectsProvider>
                                  <TasksProvider>
                                    <PendingTasksProvider>
                                      <ConversationDataProvider>
                                        <TaskViewStateProvider>
                                          <AgentProvider>
                                            <BrowserProvider>
                                              <RightSidebarProvider>
                                                <ThemeProvider>
                                                  <ErrorBoundary>{renderContent()}</ErrorBoundary>
                                                </ThemeProvider>
                                              </RightSidebarProvider>
                                            </BrowserProvider>
                                          </AgentProvider>
                                        </TaskViewStateProvider>
                                      </ConversationDataProvider>
                                    </PendingTasksProvider>
                                  </TasksProvider>
                                </PendingProjectsProvider>
                              </ProjectsProvider>
                            </WorkspaceViewProvider>
                          </IntegrationsProvider>
                        </GithubContextProvider>
                      </SshConnectionProvider>
                    </ConversationSessionsProvider>
                  </TerminalPoolProvider>
                </AppSettingsProvider>
              </AppContextProvider>
            </WorkspaceLayoutContextProvider>
          </ModalProvider>
        </DependenciesProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
