import { type ReactNode } from 'react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { AutomationsBreadcrumb } from './components/AutomationsBreadcrumb';
import { AutomationsView } from './components/AutomationsView';

export function AutomationsViewWrapper({
  children,
  automationId: _automationId,
}: {
  children: ReactNode;
  automationId?: string;
}) {
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
  TitlebarSlot: AutomationsTitlebar,
  MainPanel: AutomationsMainPanel,
};
