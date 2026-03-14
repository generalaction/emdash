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
import { ModalProvider } from './contexts/ModalProvider';
import { ProjectsProvider } from './contexts/ProjectsProvider';
import { SshConnectionProvider } from './contexts/SshConnectionProvider';
import { TasksProvider } from './contexts/TasksProvider';
import { WorkspaceLayoutContextProvider } from './contexts/WorkspaceLayoutProvider';
import { WorkspaceViewProvider } from './contexts/WorkspaceViewProvider';
import { useLocalStorage } from './hooks/useLocalStorage';
import BrowserProvider from './providers/BrowserProvider';
import { WelcomeScreen } from './views/Welcome';
import { Workspace } from './views/Workspace';

export const FIRST_LAUNCH_KEY = 'emdash:first-launch:v1';

const queryClient = new QueryClient();

export function App() {
  const [isFirstLaunch, setIsFirstLaunch] = useLocalStorage<boolean | number>(
    FIRST_LAUNCH_KEY,
    true
  );

  const renderContent = () => {
    // Handle legacy string value '1' from old implementation
    const isFirstLaunchBool = isFirstLaunch === true || isFirstLaunch === 1;

    if (isFirstLaunchBool) {
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
                <SshConnectionProvider>
                  <GithubContextProvider>
                    <IntegrationsProvider>
                      <WorkspaceViewProvider>
                        <ProjectsProvider>
                          <PendingProjectsProvider>
                            <TasksProvider>
                              {/* Add pending tasks provider here*/}
                              <AppSettingsProvider>
                                <AgentProvider>
                                  <BrowserProvider>
                                    <RightSidebarProvider>
                                      <ThemeProvider>
                                        <ErrorBoundary>{renderContent()}</ErrorBoundary>
                                      </ThemeProvider>
                                    </RightSidebarProvider>
                                  </BrowserProvider>
                                </AgentProvider>
                              </AppSettingsProvider>
                            </TasksProvider>
                          </PendingProjectsProvider>
                        </ProjectsProvider>
                      </WorkspaceViewProvider>
                    </IntegrationsProvider>
                  </GithubContextProvider>
                </SshConnectionProvider>
              </AppContextProvider>
            </WorkspaceLayoutContextProvider>
          </ModalProvider>
        </DependenciesProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
