import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './components/ThemeProvider';
import { RightSidebarProvider } from './components/ui/right-sidebar';
import { SidebarProvider } from './components/ui/sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import { AgentProvider } from './contexts/AgentProvider';
import { AppContextProvider } from './contexts/AppContextProvider';
import { AppSettingsProvider } from './contexts/AppSettingsProvider';
import { DependenciesProvider } from './contexts/DependenciesProvider';
import { GithubContextProvider } from './contexts/GithubContextProvider';
import { IntegrationsProvider } from './contexts/IntegrationsProvider';
import { KeyboardSettingsProvider } from './contexts/KeyboardSettingsContext';
import { ModalProvider } from './contexts/ModalProvider';
import { ProjectManagementProvider } from './contexts/ProjectManagementProvider';
import { TaskManagementProvider } from './contexts/TaskManagementProvider';
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
                <GithubContextProvider>
                  <IntegrationsProvider>
                    {/* WorkspaceViewProvider must be above data providers so navigate() is available
                  inside ProjectManagementProvider and TaskManagementProvider hooks */}
                    <WorkspaceViewProvider>
                      <ProjectManagementProvider>
                        <TaskManagementProvider>
                          <AppSettingsProvider>
                            <AgentProvider>
                              <KeyboardSettingsProvider>
                                <BrowserProvider>
                                  <SidebarProvider>
                                    <RightSidebarProvider>
                                      <ThemeProvider>
                                        <ErrorBoundary>{renderContent()}</ErrorBoundary>
                                      </ThemeProvider>
                                    </RightSidebarProvider>
                                  </SidebarProvider>
                                </BrowserProvider>
                              </KeyboardSettingsProvider>
                            </AgentProvider>
                          </AppSettingsProvider>
                        </TaskManagementProvider>
                      </ProjectManagementProvider>
                    </WorkspaceViewProvider>
                  </IntegrationsProvider>
                </GithubContextProvider>
              </AppContextProvider>
            </WorkspaceLayoutContextProvider>
          </ModalProvider>
        </DependenciesProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
