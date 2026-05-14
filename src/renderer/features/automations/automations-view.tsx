import type { ReactNode } from 'react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { AutomationsView } from './components/AutomationsView';

export function AutomationsTitlebar() {
  return <Titlebar />;
}

export function AutomationsMainPanel() {
  return <AutomationsView />;
}

interface AutomationsViewWrapperProps {
  children: ReactNode;
  selectedAutomationId?: string;
}

// Empty wrapper used purely to declare the params accepted by the
// `automations` view (so callers can `navigate('automations', { ... })`).
export function AutomationsViewWrapper({ children }: AutomationsViewWrapperProps) {
  return <>{children}</>;
}

export const automationsView = {
  WrapView: AutomationsViewWrapper,
  TitlebarSlot: AutomationsTitlebar,
  MainPanel: AutomationsMainPanel,
};
