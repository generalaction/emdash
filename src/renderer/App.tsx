import { ThemeProvider } from './components/ThemeProvider';
import ErrorBoundary from './components/ErrorBoundary';
import { WelcomeScreen } from './views/Welcome';
import { Workspace } from './views/Workspace';
import { useLocalStorage } from './hooks/useLocalStorage';

export function App() {
  const [isFirstLaunch, setIsFirstLaunch] = useLocalStorage<boolean>('app_first_launch', true);

  const renderContent = () => {
    switch (isFirstLaunch) {
      case true:
        return <WelcomeScreen onGetStarted={() => setIsFirstLaunch(false)} />;
      case false:
        return <Workspace />;
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
