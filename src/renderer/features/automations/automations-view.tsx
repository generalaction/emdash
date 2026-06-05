import { type ReactNode } from 'react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { AutomationsBreadcrumb } from './components/AutomationsBreadcrumb';
import { AutomationsView } from './components/AutomationsView';

export function AutomationsViewWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function AutomationsTitlebar() {
  return <Titlebar leftSlot={<AutomationsBreadcrumb />} />;
}

export function AutomationsMainPanel() {
  return <AutomationsView />;
}

export const automationsView = {
  WrapView: AutomationsViewWrapper,
  MainPanel: AutomationsMainPanel,
};
