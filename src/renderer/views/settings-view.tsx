import { createContext, useContext, type ReactNode } from 'react';
import { Titlebar } from '@/components/titlebar/Titlebar';
import { SettingsPage, type SettingsPageTab } from '@/components/SettingsPage';
import { useWorkspaceNavigation } from '@/contexts/WorkspaceNavigationContext';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

const SettingsTabContext = createContext<SettingsPageTab>('general');

export function useSettingsTab(): SettingsPageTab {
  return useContext(SettingsTabContext);
}

interface SettingsViewWrapperProps {
  children: ReactNode;
  tab?: SettingsPageTab;
}

export function SettingsViewWrapper({ children, tab = 'general' }: SettingsViewWrapperProps) {
  return <SettingsTabContext.Provider value={tab}>{children}</SettingsTabContext.Provider>;
}

export function SettingsTitlebar() {
  const { navigate } = useWorkspaceNavigation();
  return (
    <Titlebar>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={() => navigate('home')}
        aria-label="Back to home"
      >
        <ArrowLeft className="h-4 w-4" />
      </Button>
    </Titlebar>
  );
}

export function SettingsMainPanel() {
  const tab = useSettingsTab();
  const { navigate } = useWorkspaceNavigation();
  return (
    <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <SettingsPage initialTab={tab} onClose={() => navigate('home')} />
    </div>
  );
}
