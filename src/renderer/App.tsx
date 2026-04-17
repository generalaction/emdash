import { ThemeProvider } from './components/ThemeProvider';
import ErrorBoundary from './components/ErrorBoundary';
import { WelcomeScreen } from './views/Welcome';
import { Workspace } from './views/Workspace';
import { useLocalStorage } from './hooks/useLocalStorage';
import { FIRST_LAUNCH_KEY } from './constants/layout';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppSettingsProvider } from './contexts/AppSettingsProvider';
import { AppContextProvider } from './contexts/AppContextProvider';
import { GithubContextProvider } from './contexts/GithubContextProvider';
import { EmdashAccountProvider } from './contexts/EmdashAccountProvider';
import { PostHogFeatureFlagProvider } from './contexts/PostHogFeatureFlagProvider';
import { ProjectManagementProvider } from './contexts/ProjectManagementProvider';
import { TaskManagementProvider } from './contexts/TaskManagementContext';
import { NavigationHistoryProvider } from './contexts/NavigationHistoryProvider';
import { ModalProvider } from './contexts/ModalProvider';

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
        <AppContextProvider>
          <EmdashAccountProvider>
            <PostHogFeatureFlagProvider>
              <GithubContextProvider>
                <ProjectManagementProvider>
                  <TaskManagementProvider>
                    <NavigationHistoryProvider>
                      <AppSettingsProvider>
                        <ThemeProvider>
                          <ErrorBoundary>{renderContent()}</ErrorBoundary>
                        </ThemeProvider>
                      </AppSettingsProvider>
                    </NavigationHistoryProvider>
                  </TaskManagementProvider>
                </ProjectManagementProvider>
              </GithubContextProvider>
            </PostHogFeatureFlagProvider>
          </EmdashAccountProvider>
        </AppContextProvider>
      </ModalProvider>
    </QueryClientProvider>
  );
}
