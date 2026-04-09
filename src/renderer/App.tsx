import { QueryClientProvider } from '@tanstack/react-query';
import ErrorBoundary from './components/error-boundary';
import { RightSidebarProvider } from './components/ui/right-sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import { IntegrationsProvider } from './core/integrations/integrations-provider';
import { ModalProvider } from './core/modal/modal-provider';
import { TerminalPoolProvider } from './core/pty/pty-pool-provider';
import { queryClient } from './core/query-client';
import { WorkspaceLayoutContextProvider } from './core/view/layout-provider';
import { WorkspaceViewProvider } from './core/view/provider';
import { useLocalStorage } from './hooks/useLocalStorage';
import { GithubContextProvider } from './providers/github-context-provider';
import { SshConnectionProvider } from './providers/ssh-connection-provider';
import { ThemeProvider } from './providers/theme-provider';
import { WelcomeScreen } from './views/welcome';
import { Workspace } from './views/workspace';

export const FIRST_LAUNCH_KEY = 'emdash:first-launch:v1';

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
        <ModalProvider>
          <WorkspaceLayoutContextProvider>
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
          </WorkspaceLayoutContextProvider>
        </ModalProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
