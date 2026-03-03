import { ThemeProvider } from './components/ThemeProvider';
import ErrorBoundary from './components/ErrorBoundary';
import { WelcomeScreen } from './views/Welcome';
import { Workspace } from './views/Workspace';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppSettingsProvider, useAppSettings } from './contexts/AppSettingsProvider';

const queryClient = new QueryClient();

function AppContent() {
  const { settings, isLoading, updateSettings } = useAppSettings();

  if (isLoading || !settings) return null;

  if (!settings.onboardingSeen) {
    return <WelcomeScreen onGetStarted={() => updateSettings({ onboardingSeen: true })} />;
  }

  return <Workspace />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppSettingsProvider>
        <ThemeProvider>
          <ErrorBoundary>
            <AppContent />
          </ErrorBoundary>
        </ThemeProvider>
      </AppSettingsProvider>
    </QueryClientProvider>
  );
}
