import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { AutomationsBreadcrumb } from './components/AutomationsBreadcrumb';
import { AutomationsView } from './components/AutomationsView';

export type AutomationsTab = 'all' | 'runs';

export const AUTOMATIONS_TABS: Array<{ id: AutomationsTab; label: string }> = [
  { id: 'all', label: 'All Automations' },
  { id: 'runs', label: 'Recent Runs' },
];

const AutomationsTabContext = createContext<{
  tab: AutomationsTab;
  onTabChange: (tab: AutomationsTab) => void;
}>({ tab: 'all', onTabChange: () => {} });

export function useAutomationsTab() {
  return useContext(AutomationsTabContext);
}

interface AutomationsViewWrapperProps {
  children: ReactNode;
  selectedAutomationId?: string;
  selectedRunId?: string;
  tab?: AutomationsTab;
}

export function AutomationsViewWrapper({ children, tab = 'all' }: AutomationsViewWrapperProps) {
  const { setParams } = useParams('automations');
  const handleTabChange = useCallback(
    (nextTab: AutomationsTab) => {
      setParams({ tab: nextTab, selectedAutomationId: undefined, selectedRunId: undefined });
    },
    [setParams]
  );

  return (
    <AutomationsTabContext.Provider value={{ tab, onTabChange: handleTabChange }}>
      {children}
    </AutomationsTabContext.Provider>
  );
}

export function AutomationsTitlebar() {
  return <Titlebar leftSlot={<AutomationsBreadcrumb />} />;
}

export function AutomationsMainPanel() {
  return <AutomationsView />;
}

export const automationsView = {
  WrapView: AutomationsViewWrapper,
  TitlebarSlot: AutomationsTitlebar,
  MainPanel: AutomationsMainPanel,
};
