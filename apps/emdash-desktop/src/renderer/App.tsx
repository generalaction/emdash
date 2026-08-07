import { Tooltip } from '@emdash/ui/react/primitives';
import { QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useAccountSession } from '@core/features/account/api/browser/useAccount';
import { GithubContextProvider } from '@core/features/github/api/browser/github-context-provider';
import { IntegrationsProvider } from '@core/features/integrations/api/browser/integrations-provider';
import { useLegacyPortStatus } from '@core/features/legacy-port/api/browser/useLegacyPort';
import { TerminalPoolProvider } from '@core/features/terminals/browser/pty/pty-pool-provider';
import { confirmOpenExternalLink } from '@core/features/workbench/api/browser/open-external-link';
import { Onboarding } from '@core/features/workbench/browser/onboarding/onboarding';
import { FramelessTitlebarOverlay } from '@core/features/workbench/browser/window-controls';
import { ExternalLinkProvider } from '@core/primitives/external-links/browser';
import { WorkspaceLayoutContextProvider } from '@core/primitives/layouts/react/layout-provider';
import { queryClient } from '@core/primitives/query/browser/query-client';
import { RightSidebarProvider } from '@renderer/lib/layout/right-sidebar';
import { AppMenuEvents } from './app/app-menu-events';
import { AppShutdownLifecycle } from './app/app-shutdown-lifecycle';
import { WelcomeScreen } from './app/welcome';
import { Workspace } from './app/workspace';
import { WorkspaceViewProvider } from './lib/layout/provider';
import { ModalRenderer } from './lib/modal/modal-renderer';
import { FeatureFlagProvider } from './lib/providers/feature-flag-override-context';
import { ThemeProvider } from './lib/providers/theme-provider';

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
      setFrozenSteps(computed);
    }
  }, [view, isLoading, frozenSteps, session, legacyStatus]);

  const stepsNeeded = frozenSteps ?? [];

  const handleOnboardingComplete = () => {
    localStorage.setItem(HAS_SEEN_ONBOARDING, 'true');
    setView('welcome');
  };

  const handleOpenSettingsFromMenu = useCallback(() => {
    if (view === 'onboarding' && stepsNeeded.length > 0) return false;
    setView('workspace');
    return true;
  }, [view, stepsNeeded.length]);

  const renderContent = () => {
    // Linux runs frameless (`frame: false`), so every branch — including the
    // pre-resolution loading window — must mount the overlay to keep window
    // controls and a drag region available.
    if (isLoading || (view === 'onboarding' && frozenSteps === null)) {
      return <FramelessTitlebarOverlay />;
    }
    if (view === 'onboarding' && stepsNeeded.length > 0) {
      return (
        <>
          <Onboarding steps={stepsNeeded} onComplete={handleOnboardingComplete} />
          <FramelessTitlebarOverlay />
        </>
      );
    }
    // The welcome splash is an opaque full-screen overlay, so the Workspace
    // would be fully hidden behind it; render it standalone to avoid mounting a
    // second, hidden WindowControls (the Workspace Titlebar's) underneath.
    if (view === 'welcome') {
      return (
        <>
          <WelcomeScreen onGetStarted={() => window.location.reload()} />
          <FramelessTitlebarOverlay />
        </>
      );
    }
    return <Workspace />;
  };

  return (
    <Tooltip.Provider delay={300}>
      <WorkspaceLayoutContextProvider>
        <TerminalPoolProvider>
          <GithubContextProvider>
            <IntegrationsProvider>
              <WorkspaceViewProvider>
                <AppMenuEvents onOpenSettings={handleOpenSettingsFromMenu} />
                <RightSidebarProvider>
                  <ExternalLinkProvider openExternalLink={confirmOpenExternalLink}>
                    <ThemeProvider>
                      <ModalRenderer />
                      <AppShutdownLifecycle />
                      {renderContent()}
                    </ThemeProvider>
                  </ExternalLinkProvider>
                </RightSidebarProvider>
              </WorkspaceViewProvider>
            </IntegrationsProvider>
          </GithubContextProvider>
        </TerminalPoolProvider>
      </WorkspaceLayoutContextProvider>
    </Tooltip.Provider>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <FeatureFlagProvider>
        <AppContent />
      </FeatureFlagProvider>
    </QueryClientProvider>
  );
}
