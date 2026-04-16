import { QueryClientProvider } from '@tanstack/react-query';
import { WelcomeScreen } from './app/welcome';
import { Workspace } from './app/workspace';
import { IntegrationsProvider } from './features/integrations/integrations-provider';
import ErrorBoundary from './lib/components/error-boundary';
import { useLocalStorage } from './lib/hooks/useLocalStorage';
import { WorkspaceLayoutContextProvider } from './lib/layout/layout-provider';
import { WorkspaceViewProvider } from './lib/layout/provider';
import { ModalProvider } from './lib/modal/modal-provider';
import { GithubContextProvider } from './lib/providers/github-context-provider';
import { ThemeProvider } from './lib/providers/theme-provider';
import { TerminalPoolProvider } from './lib/pty/pty-pool-provider';
import { queryClient } from './lib/query-client';
import { RightSidebarProvider } from './lib/ui/right-sidebar';
import { TooltipProvider } from './lib/ui/tooltip';

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
            </TerminalPoolProvider>
          </WorkspaceLayoutContextProvider>
        </ModalProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
