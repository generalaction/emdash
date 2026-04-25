import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { WelcomeScreen } from './app/welcome';
import { Workspace } from './app/workspace';
import { IntegrationsProvider } from './features/integrations/integrations-provider';
import { Onboarding } from './features/onboarding/onboarding';
import { useAccountSession } from './lib/hooks/useAccount';
import { useLegacyPortStatus } from './lib/hooks/useLegacyPort';
import { WorkspaceLayoutContextProvider } from './lib/layout/layout-provider';
import { WorkspaceViewProvider } from './lib/layout/provider';
import { ModalProvider } from './lib/modal/modal-provider';
import { GithubContextProvider } from './lib/providers/github-context-provider';
import { ThemeProvider } from './lib/providers/theme-provider';
import { TerminalPoolProvider } from './lib/pty/pty-pool-provider';
import { queryClient } from './lib/query-client';
import { RightSidebarProvider } from './lib/ui/right-sidebar';
import { TooltipProvider } from './lib/ui/tooltip';

export const HAS_SEEN_ONBOARDING = 'emdash:has-seen-onboarding:v1';

type AppView = 'onboarding' | 'welcome' | 'workspace';
type OnboardingStep = 'sign-in' | 'import';

function AppContent() {
  const [view, setView] = useState<AppView>(() =>
    localStorage.getItem(HAS_SEEN_ONBOARDING) === 'true' ? 'workspace' : 'onboarding'
  );

  const { data: session, isLoading: sessionLoading } = useAccountSession();
  const { data: legacyStatus, isLoading: legacyLoading } = useLegacyPortStatus();

  const isLoading = sessionLoading || legacyLoading;

  const stepsNeeded: OnboardingStep[] = [];
  if (!isLoading && view === 'onboarding') {
    if (!session?.isSignedIn) {
      stepsNeeded.push('sign-in');
    }
    const needsImport =
      legacyStatus?.hasLegacyDb &&
      legacyStatus.portStatus !== 'completed' &&
      legacyStatus.portStatus !== 'no-legacy-file' &&
      !legacyStatus.hasExistingData;
    if (needsImport) {
      stepsNeeded.push('import');
    }
  }

  const handleOnboardingComplete = () => {
    localStorage.setItem(HAS_SEEN_ONBOARDING, 'true');
    setView('welcome');
  };

  const renderContent = () => {
    if (isLoading) {
      return null;
    }
    if (view === 'onboarding' && stepsNeeded.length > 0) {
      return <Onboarding steps={stepsNeeded} onComplete={handleOnboardingComplete} />;
    }
    return (
      <>
        <Workspace />
        {view === 'welcome' && <WelcomeScreen onGetStarted={() => window.location.reload()} />}
      </>
    );
  };

  return (
    <TooltipProvider delay={300}>
      <ModalProvider>
        <WorkspaceLayoutContextProvider>
          <TerminalPoolProvider>
            <GithubContextProvider>
              <IntegrationsProvider>
                <WorkspaceViewProvider>
                  <RightSidebarProvider>
                    <ThemeProvider>{renderContent()}</ThemeProvider>
                  </RightSidebarProvider>
                </WorkspaceViewProvider>
              </IntegrationsProvider>
            </GithubContextProvider>
          </TerminalPoolProvider>
        </WorkspaceLayoutContextProvider>
      </ModalProvider>
    </TooltipProvider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}
