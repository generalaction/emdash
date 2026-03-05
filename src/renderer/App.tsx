import { ThemeProvider } from './components/ThemeProvider';
import ErrorBoundary from './components/ErrorBoundary';
import { WelcomeScreen } from './views/Welcome';
import { Workspace } from './views/Workspace';
import { useLocalStorage } from './hooks/useLocalStorage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppSettingsProvider } from './contexts/AppSettingsProvider';
import { AppContextProvider } from './contexts/AppContextProvider';
import { GithubContextProvider } from './contexts/GithubContextProvider';
import { IntegrationsProvider } from './contexts/IntegrationsProvider';
import { ProjectManagementProvider } from './contexts/ProjectManagementProvider';
import { TaskManagementProvider } from './contexts/TaskManagementProvider';
import { ModalProvider } from './contexts/ModalProvider';
import { WorkspaceLayoutContextProvider } from './contexts/WorkspaceLayoutProvider';
import { WorkspaceViewProvider } from './contexts/WorkspaceViewProvider';
import { KeyboardSettingsProvider } from './contexts/KeyboardSettingsContext';
import { AgentProvider } from './contexts/AgentProvider';
import BrowserProvider from './providers/BrowserProvider';
import { RightSidebarProvider } from './components/ui/right-sidebar';
import { SidebarProvider } from './components/ui/sidebar';

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
    </QueryClientProvider>
  );
}
