import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { PendingProjectsProvider } from './components/add-project-modal/pending-projects-provider';
import ErrorBoundary from './components/error-boundary';
import { RightSidebarProvider } from './components/ui/right-sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import { AppContextProvider } from './core/app/AppContextProvider';
import { AppSettingsProvider } from './core/app/AppSettingsProvider';
import { ThemeProvider } from './core/app/ThemeProvider';
import { AgentProvider } from './core/conversations/AgentProvider';
import { ConversationDataProvider } from './core/conversations/conversation-data-provider';
import { DependenciesProvider } from './core/dependencies-provider';
import { GithubContextProvider } from './core/github-context-provider';
import { IntegrationsProvider } from './core/integrations/integrations-provider';
import { ModalProvider } from './core/modal/modal-provider';
import { codeEditorPool } from './core/monaco/monaco-code-pool';
import { diffEditorPool } from './core/monaco/monaco-diff-pool';
import { ProjectBootstrapProvider } from './core/projects/project-bootstrap-provider';
import { ProjectsDataProvider } from './core/projects/projects-data-provider';
import { TerminalPoolProvider } from './core/pty/pty-pool-provider';
import { PtySessionProvider } from './core/pty/pty-session-context';
import { SshConnectionProvider } from './core/ssh/ssh-connection-provider';
import { TaskLifecycleProvider } from './core/tasks/task-lifecycle-provider';
import { TasksDataProvider } from './core/tasks/tasks-data-provider';
import { TerminalDataProvider } from './core/terminals/terminal-data-provider';
import { WorkspaceLayoutContextProvider } from './core/view/layout-provider';
import { WorkspaceViewProvider } from './core/view/provider';
import { useLocalStorage } from './hooks/useLocalStorage';
import { WelcomeScreen } from './views/welcome';
import { Workspace } from './views/workspace';

export const FIRST_LAUNCH_KEY = 'emdash:first-launch:v1';

const queryClient = new QueryClient();

export function App() {
  const [isFirstLaunch, setIsFirstLaunch] = useLocalStorage<boolean>(FIRST_LAUNCH_KEY, true);

  // Pre-warm Monaco off the critical path so the first file open is instant.
  useEffect(() => {
    codeEditorPool.init(0).catch(console.warn);
    diffEditorPool.init(3).catch(console.warn);
  }, []);

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
                <AppSettingsProvider>
                  <TerminalPoolProvider>
                    <PtySessionProvider>
                      <SshConnectionProvider>
                        <GithubContextProvider>
                          <IntegrationsProvider>
                            <WorkspaceViewProvider>
                              <ProjectsDataProvider>
                                <PendingProjectsProvider>
                                  <ProjectBootstrapProvider>
                                    <TasksDataProvider>
                                      <TaskLifecycleProvider>
                                        <ConversationDataProvider>
                                          <TerminalDataProvider>
                                            <AgentProvider>
                                              <RightSidebarProvider>
                                                <ThemeProvider>
                                                  <ErrorBoundary>{renderContent()}</ErrorBoundary>
                                                </ThemeProvider>
                                              </RightSidebarProvider>
                                            </AgentProvider>
                                          </TerminalDataProvider>
                                        </ConversationDataProvider>
                                      </TaskLifecycleProvider>
                                    </TasksDataProvider>
                                  </ProjectBootstrapProvider>
                                </PendingProjectsProvider>
                              </ProjectsDataProvider>
                            </WorkspaceViewProvider>
                          </IntegrationsProvider>
                        </GithubContextProvider>
                      </SshConnectionProvider>
                    </PtySessionProvider>
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
