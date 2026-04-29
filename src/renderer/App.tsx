import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { WelcomeScreen } from './app/welcome';
import { Workspace } from './app/workspace';
import { IntegrationsProvider } from './features/integrations/integrations-provider';
import { Onboarding } from './features/onboarding/onboarding';
import { ForkDetectionListener } from './features/projects/components/fork-detection-listener';
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

  // Computed once when queries first resolve while in onboarding. Never updated
  // after that so query refetches mid-onboarding (e.g. legacyPortStatus after
  // import completes) cannot shrink the step list and unmount active step components.
  const [frozenSteps, setFrozenSteps] = useState<OnboardingStep[] | null>(null);

  useEffect(() => {
    if (!isLoading && view === 'onboarding' && frozenSteps === null) {
      const computed: OnboardingStep[] = [];
      if (!session?.isSignedIn) computed.push('sign-in');
      const needsImport = legacyStatus?.hasImportSources && !legacyStatus.portStatus;
      if (needsImport) computed.push('import');
      // eslint-disable-next-line react-hooks/exhaustive-deps
      setFrozenSteps(computed);
    }
  }, [view, isLoading, frozenSteps, session, legacyStatus]);

  const stepsNeeded = frozenSteps ?? [];

  const handleOnboardingComplete = () => {
    localStorage.setItem(HAS_SEEN_ONBOARDING, 'true');
    setView('welcome');
  };

  const renderContent = () => {
    if (isLoading || (view === 'onboarding' && frozenSteps === null)) {
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
        <ForkDetectionListener />
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
