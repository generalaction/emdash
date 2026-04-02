import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ErrorBoundary from './components/error-boundary';
import { RightSidebarProvider } from './components/ui/right-sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import { AppContextProvider } from './core/app/AppContextProvider';
import { ThemeProvider } from './core/app/ThemeProvider';
import { DependenciesProvider } from './core/dependencies-provider';
// Import to ensure singleton initialises and subscribes to agentEventChannel.
import './core/stores/agent-notification-store';
import { GithubContextProvider } from './core/github-context-provider';
import { IntegrationsProvider } from './core/integrations/integrations-provider';
import { ModalProvider } from './core/modal/modal-provider';
import { TerminalPoolProvider } from './core/pty/pty-pool-provider';
import { SshConnectionProvider } from './core/ssh/ssh-connection-provider';
import { WorkspaceLayoutContextProvider } from './core/view/layout-provider';
import { WorkspaceViewProvider } from './core/view/provider';
import { useLocalStorage } from './hooks/useLocalStorage';
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
      <TooltipProvider delay={300}>
        <DependenciesProvider>
          <ModalProvider>
            <WorkspaceLayoutContextProvider>
              <AppContextProvider>
                <TerminalPoolProvider>
                  <SshConnectionProvider>
                    <GithubContextProvider>
                      <IntegrationsProvider>
                        <WorkspaceViewProvider>
                          <RightSidebarProvider>
                            <ThemeProvider>
                              <ErrorBoundary>{renderContent()}</ErrorBoundary>
                            </ThemeProvider>
                          </RightSidebarProvider>
                        </WorkspaceViewProvider>
                      </IntegrationsProvider>
                    </GithubContextProvider>
                  </SshConnectionProvider>
                </TerminalPoolProvider>
              </AppContextProvider>
            </WorkspaceLayoutContextProvider>
          </ModalProvider>
        </DependenciesProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
