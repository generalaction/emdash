import { ThemeProvider } from './components/ThemeProvider';
import ErrorBoundary from './components/ErrorBoundary';
import { WelcomeScreen } from './views/Welcome';
import { Workspace } from './views/Workspace';
import { useLocalStorage } from './hooks/useLocalStorage';
import { FIRST_LAUNCH_KEY } from './constants/layout';
import { WorkspaceOverlayProvider } from './contexts/WorkspaceOverlayContext';

export function App() {
  const [isFirstLaunch, setIsFirstLaunch] = useLocalStorage<boolean>(FIRST_LAUNCH_KEY, true);

  const renderContent = () => {
    switch (isFirstLaunch) {
      case true:
        return <WelcomeScreen onGetStarted={() => setIsFirstLaunch(false)} />;
      case false:
        return (
          <WorkspaceOverlayProvider>
            <Workspace />
          </WorkspaceOverlayProvider>
        );
      default:
        return null;
    }
  };
  return (
    <ThemeProvider>
      <ErrorBoundary>{renderContent()}</ErrorBoundary>
    </ThemeProvider>
  );
}
